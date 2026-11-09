// Chrome native-messaging host: reports which non-Chrome apps are outputting audio
// and how loud the quietest of them is (Core Audio process objects + taps, macOS 14.2+).
import CoreAudio
import Darwin
import Foundation

// Chrome is handled per-tab in the extension; system UI blips (volume-key pop,
// alerts, charger chime) are too short to duck for and made volume keys feel laggy.
let ignoredPrefixes = ["com.google.chrome", "com.apple.audio", "com.apple.corespeech",
                       "systemsoundserverd", "com.apple.powerchime"] // lowercase

func prop<T>(_ id: AudioObjectID, _ sel: AudioObjectPropertySelector, _ initial: T) -> T? {
  var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var value = initial
  var size = UInt32(MemoryLayout<T>.size)
  return withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(id, &addr, 0, nil, &size, $0) } == noErr ? value : nil
}

func addr(_ sel: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}

func listen(_ id: AudioObjectID, _ sel: AudioObjectPropertySelector, _ block: @escaping () -> Void) {
  var a = addr(sel)
  AudioObjectAddPropertyListenerBlock(id, &a, .main) { _, _ in block() }
}

func processList() -> [AudioObjectID] {
  let sys = AudioObjectID(kAudioObjectSystemObject)
  var a = addr(kAudioHardwarePropertyProcessObjectList)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(sys, &a, 0, nil, &size) == noErr else { return [] }
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(sys, &a, 0, nil, &size, &ids) == noErr else { return [] }
  return ids
}

/// Bundle ID (or process name for CLI tools), or nil for processes we never duck for.
func duckableName(_ id: AudioObjectID) -> String? {
  guard let pid = prop(id, kAudioProcessPropertyPID, pid_t(0)), pid != getpid() else { return nil } // our taps run IO too
  var a = addr(kAudioProcessPropertyBundleID)
  var bundle: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  var name = AudioObjectGetPropertyData(id, &a, 0, nil, &size, &bundle) == noErr ? (bundle?.takeRetainedValue() as String? ?? "") : ""
  if name.isEmpty {
    var buf = [CChar](repeating: 0, count: 1024)
    if proc_name(pid, &buf, 1024) > 0 { name = String(cString: buf) }
  }
  if name.isEmpty || ignoredPrefixes.contains(where: name.lowercased().hasPrefix) { return nil }
  return name
}

/// Which duckable processes are outputting audio, kept current by Core Audio property
/// listeners. (Polling every process object 5x/s kept coreaudiod at ~75% CPU, which
/// lagged all audio on the Mac.)
final class Watcher {
  private(set) var playing: [AudioObjectID: String] = [:]
  private var known: [AudioObjectID: String?] = [:] // nil name = ignored process
  var onChange: () -> Void = {}

  init() {
    listen(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyProcessObjectList) { [weak self] in self?.refresh() }
    refresh()
  }

  private func refresh() {
    let ids = Set(processList())
    for id in ids where known[id] == nil {
      let name = duckableName(id)
      known[id] = .some(name)
      guard name != nil else { continue }
      // IsRunningOutput itself never notifies; IsRunning does (start and stop).
      listen(id, kAudioProcessPropertyIsRunning) { [weak self] in self?.check(id) }
      check(id, notify: false)
    }
    for id in known.keys where !ids.contains(id) { known.removeValue(forKey: id); playing.removeValue(forKey: id) }
    onChange()
  }

  private func check(_ id: AudioObjectID, notify: Bool = true) {
    guard let name = known[id] ?? nil else { return }
    playing[id] = prop(id, kAudioProcessPropertyIsRunningOutput, UInt32(0)) == 1 ? name : nil
    if notify { onChange() }
  }
}

func defaultOutputUID() -> String? {
  guard let dev = prop(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultSystemOutputDevice, AudioObjectID(0)) else { return nil }
  var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceUID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var uid: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  guard AudioObjectGetPropertyData(dev, &addr, 0, nil, &size, &uid) == noErr else { return nil }
  return uid?.takeRetainedValue() as String?
}

func send(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
  var len = UInt32(data.count).littleEndian
  FileHandle.standardOutput.write(Data(bytes: &len, count: 4) + data)
}

if CommandLine.arguments.contains("--print") {
  print(Set(Watcher().playing.values).sorted()); exit(0)
}

// Timestamped trail of detections + extension events, for latency debugging.
let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/music-duck.log")
let logFormat = ISO8601DateFormatter()
logFormat.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
func log(_ line: String) {
  let entry = Data("\(logFormat.string(from: Date())) \(line)\n".utf8)
  if let h = try? FileHandle(forWritingTo: logURL) { h.seekToEndOfFile(); h.write(entry); try? h.close() }
  else { try? entry.write(to: logURL) }
}

// Read framed messages from the extension (log lines). Chrome closes stdin on disconnect; exit then.
Thread.detachNewThread {
  let stdin = FileHandle.standardInput
  while true {
    let header = stdin.readData(ofLength: 4)
    guard header.count == 4 else { exit(0) }
    let len = header.withUnsafeBytes { Int(UInt32(littleEndian: $0.loadUnaligned(as: UInt32.self))) }
    let body = stdin.readData(ofLength: len)
    guard body.count == len else { exit(0) }
    let text = String(decoding: body, as: UTF8.self)
    DispatchQueue.main.async { log("ext  \(text)") }
  }
}
log("host start")

let holdSeconds = 3.0
var meters: [AudioObjectID: Meter] = [:]
var meterClock: String?
var lastApps: [String]? = nil
var lastQuietest: Double? = nil
let watcher = Watcher()

// Taps are clocked by the output device; rebuild them when it changes (e.g. AirPods).
func syncMeters() {
  let clock = defaultOutputUID()
  if clock != meterClock { meters.values.forEach { $0.stop() }; meters = [:]; meterClock = clock }
  for id in meters.keys where watcher.playing[id] == nil { meters.removeValue(forKey: id)?.stop() }
  if let clock { for id in watcher.playing.keys where meters[id] == nil { meters[id] = Meter(process: id, clockDeviceUID: clock) } }
}

func report() {
  // Apps keep their output running ~2s after they stop (and some hold it open while
  // silent). Once taps are proven to deliver audio, a metered process only counts
  // while it has made sound within `holdSeconds`. The hold must outlast pauses in
  // speech: at 0.5s every pause in a video restored the music, then ducked it again.
  var audible: [AudioObjectID: String] = [:]
  var appLevel: [String: Double] = [:]
  for (id, name) in watcher.playing {
    let meter = meters[id]
    let level = meter?.level()
    guard meter == nil || !Meter.tapsDeliverAudio || meter!.soundWithin(holdSeconds) else { continue }
    audible[id] = name
    // An app is as loud as its loudest process; duck for the quietest app so it stays audible.
    if let level { appLevel[name] = max(appLevel[name] ?? -.infinity, level) }
  }
  let apps = Set(audible.values).sorted()
  let quietest = appLevel.values.min()

  let levelMoved = (quietest == nil) != (lastQuietest == nil) || abs((quietest ?? 0) - (lastQuietest ?? 0)) >= 1
  guard apps != lastApps || levelMoved else { return }
  var msg: [String: Any] = ["apps": apps]
  if let quietest { msg["quietestLufs"] = (quietest * 10).rounded() / 10 }
  if apps != lastApps || abs((quietest ?? 0) - (lastQuietest ?? 0)) >= 3 { log("host apps=\(apps) quietestLufs=\(msg["quietestLufs"] ?? "nil")") }
  send(msg)
  lastApps = apps; lastQuietest = quietest
}

watcher.onChange = { syncMeters(); report() }
listen(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultSystemOutputDevice) { syncMeters() }
syncMeters()
report()
// Level ticks only read local meter accumulators: no Core Audio IPC here.
Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { _ in report() }
RunLoop.main.run()

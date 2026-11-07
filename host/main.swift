// Chrome native-messaging host: reports which non-Chrome apps are outputting audio.
// Uses Core Audio process objects (macOS 14.2+); no audio capture, no permissions.
import CoreAudio
import Darwin
import Foundation

// Chrome's own audio is handled per-tab in the extension.
let ignoredPrefixes = ["com.google.chrome", "com.apple.audio", "com.apple.corespeech"] // lowercase

func prop<T>(_ id: AudioObjectID, _ sel: AudioObjectPropertySelector, _ initial: T) -> T? {
  var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var value = initial
  var size = UInt32(MemoryLayout<T>.size)
  return withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(id, &addr, 0, nil, &size, $0) } == noErr ? value : nil
}

func audibleApps() -> [String] {
  let sys = AudioObjectID(kAudioObjectSystemObject)
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(sys, &addr, 0, nil, &size) == noErr else { return [] }
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(sys, &addr, 0, nil, &size, &ids) == noErr else { return [] }
  var apps = Set<String>()
  for id in ids where prop(id, kAudioProcessPropertyIsRunningOutput, UInt32(0)) == 1 {
    var bundle: Unmanaged<CFString>?
    var bAddr = AudioObjectPropertyAddress(mSelector: kAudioProcessPropertyBundleID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var bSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    var name = AudioObjectGetPropertyData(id, &bAddr, 0, nil, &bSize, &bundle) == noErr
      ? (bundle?.takeRetainedValue() as String? ?? "") : ""
    // CLI tools (afplay, etc.) have no bundle ID; fall back to process name.
    if name.isEmpty, let pid = prop(id, kAudioProcessPropertyPID, pid_t(0)) {
      var buf = [CChar](repeating: 0, count: 1024)
      if proc_name(pid, &buf, 1024) > 0 { name = String(cString: buf) }
    }
    if name.isEmpty || ignoredPrefixes.contains(where: name.lowercased().hasPrefix) { continue }
    apps.insert(name)
  }
  return apps.sorted()
}

func send(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
  var len = UInt32(data.count).littleEndian
  FileHandle.standardOutput.write(Data(bytes: &len, count: 4) + data)
}

if CommandLine.arguments.contains("--print") {
  print(audibleApps()); exit(0)
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

// Poll on the main run loop: Core Audio delivers property updates through it,
// so a bare sleep loop reads stale IsRunningOutput values.
var last: [String]? = nil
Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { _ in
  let apps = audibleApps()
  if apps != last { log("host apps=\(apps)"); send(["apps": apps]); last = apps }
}.fire()
RunLoop.main.run()

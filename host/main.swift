// Chrome native-messaging host: reports which non-Chrome apps are outputting audio.
// Uses Core Audio process objects (macOS 14.2+); no audio capture, no permissions.
import CoreAudio
import Darwin
import Foundation

// Chrome's own audio is handled per-tab in the extension.
let ignoredPrefixes = ["com.google.Chrome", "com.apple.audio", "com.apple.CoreSpeech"]

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
    if name.isEmpty || ignoredPrefixes.contains(where: name.hasPrefix) { continue }
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

// Chrome closes stdin when the extension disconnects; exit then.
Thread.detachNewThread {
  while FileHandle.standardInput.availableData.count > 0 {}
  exit(0)
}

var last: [String]? = nil
while true {
  let apps = audibleApps()
  if apps != last { send(["apps": apps]); last = apps }
  Thread.sleep(forTimeInterval: 0.25)
}

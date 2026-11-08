// Loudness (LUFS, BS.1770 K-weighted) of one process's audio via a Core Audio
// process tap (macOS 14.2+). Needs "System Audio Recording" permission; without
// it the tap delivers silence, which reads as "no level" and the extension falls
// back to a fixed duck.
import CoreAudio
import Foundation
import os

/// One biquad section, direct form II transposed.
struct Biquad {
  var b0, b1, b2, a1, a2: Double
  var z1 = 0.0, z2 = 0.0
  mutating func run(_ x: Double) -> Double {
    let y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2
    z2 = b2 * x - a2 * y
    return y
  }
}

/// BS.1770 K-weighting (high shelf + high pass) for any sample rate (libebur128 formulas).
func kWeighting(sampleRate fs: Double) -> [Biquad] {
  var k = tan(.pi * 1681.974450955533 / fs), q = 0.7071752369554196
  let vh = pow(10, 3.999843853973347 / 20), vb = pow(vh, 0.4996667741545416)
  var a0 = 1 + k / q + k * k
  let shelf = Biquad(b0: (vh + vb * k / q + k * k) / a0, b1: 2 * (k * k - vh) / a0,
                     b2: (vh - vb * k / q + k * k) / a0, a1: 2 * (k * k - 1) / a0, a2: (1 - k / q + k * k) / a0)
  k = tan(.pi * 38.13547087602444 / fs); q = 0.5003270373238773
  a0 = 1 + k / q + k * k
  let highpass = Biquad(b0: 1, b1: -2, b2: 1, a1: 2 * (k * k - 1) / a0, a2: (1 - k / q + k * k) / a0)
  return [shelf, highpass]
}

/// K-weighted mean-square power (summed over channels) -> LUFS.
func lufs(_ power: Double) -> Double { -0.691 + 10 * log10(max(power, 1e-12)) }

final class Meter {
  private var tap = AudioObjectID(0)
  private var agg = AudioObjectID(0)
  private var ioProc: AudioDeviceIOProcID?
  /// K-weighted sum of squares per channel-frame + frame count since last tick.
  private let acc = OSAllocatedUnfairLock(initialState: (sum: 0.0, frames: 0))
  private var smoothed: Double? // gated, smoothed power
  private var lastSound: Date?

  /// Without "System Audio Recording" permission taps deliver pure digital silence, which
  /// looks the same as a quiet app. Any non-zero sample from any tap proves permission.
  nonisolated(unsafe) static var tapsDeliverAudio = false

  /// Pauses (speech gaps, track gaps) quieter than this don't move the level.
  static let gateLufs = -55.0

  init?(process: AudioObjectID, clockDeviceUID: String) {
    let desc = CATapDescription(stereoMixdownOfProcesses: [process])
    desc.isPrivate = true
    desc.muteBehavior = .unmuted
    guard AudioHardwareCreateProcessTap(desc, &tap) == noErr else { return nil }
    // A tap only runs inside an aggregate device clocked by a real output device.
    let aggDesc: [String: Any] = [
      kAudioAggregateDeviceNameKey: "music-duck-meter",
      kAudioAggregateDeviceUIDKey: UUID().uuidString,
      kAudioAggregateDeviceIsPrivateKey: true,
      kAudioAggregateDeviceMainSubDeviceKey: clockDeviceUID,
      kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: clockDeviceUID]],
      kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: desc.uuid.uuidString]],
      kAudioAggregateDeviceTapAutoStartKey: true,
    ]
    guard AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &agg) == noErr else { stop(); return nil }

    var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyNominalSampleRate, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var fs = 48000.0
    var size = UInt32(MemoryLayout<Double>.size)
    AudioObjectGetPropertyData(agg, &addr, 0, nil, &size, &fs)
    var filters = [kWeighting(sampleRate: fs), kWeighting(sampleRate: fs)] // L, R (tap is stereo mixdown)

    let acc = acc
    let err = AudioDeviceCreateIOProcIDWithBlock(&ioProc, agg, nil) { _, input, _, _, _ in
      var sum = 0.0, frames = 0
      var channel = 0
      for buf in UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input)) {
        guard let data = buf.mData else { continue }
        let samples = data.assumingMemoryBound(to: Float.self)
        let chans = max(Int(buf.mNumberChannels), 1)
        let count = Int(buf.mDataByteSize) / MemoryLayout<Float>.size
        for i in 0..<count {
          let c = min(channel + i % chans, filters.count - 1)
          var y = Double(samples[i])
          y = filters[c][0].run(y)
          y = filters[c][1].run(y)
          sum += y * y
        }
        channel += chans
        frames = max(frames, count / chans)
      }
      let (s, f) = (sum, frames)
      acc.withLock { $0.sum += s; $0.frames += f }
    }
    guard err == noErr, AudioDeviceStart(agg, ioProc) == noErr else { stop(); return nil }
  }

  /// Call every tick. Smoothed loudness in LUFS (~1s window, gated), or nil if nothing audible yet.
  func level() -> Double? {
    let (sum, frames) = acc.withLock { s in defer { s = (0, 0) }; return (s.sum, s.frames) }
    if frames > 0 {
      let power = sum / Double(frames) // channels summed, per BS.1770
      if power > 0 { Meter.tapsDeliverAudio = true }
      if lufs(power) > Meter.gateLufs {
        lastSound = Date()
        smoothed = smoothed.map { $0 + 0.25 * (power - $0) } ?? power // ~1s at 0.2s ticks
      }
    }
    return smoothed.map(lufs)
  }

  /// Made sound above the gate within the last `seconds`.
  func soundWithin(_ seconds: TimeInterval) -> Bool { lastSound.map { Date().timeIntervalSince($0) < seconds } ?? false }

  func stop() {
    if let ioProc { AudioDeviceStop(agg, ioProc); AudioDeviceDestroyIOProcID(agg, ioProc) }
    if agg != 0 { AudioHardwareDestroyAggregateDevice(agg) }
    if tap != 0 { AudioHardwareDestroyProcessTap(tap) }
    ioProc = nil; agg = 0; tap = 0
  }

  deinit { stop() }
}

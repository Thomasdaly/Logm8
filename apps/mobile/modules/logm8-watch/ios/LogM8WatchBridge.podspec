Pod::Spec.new do |s|
  s.name           = 'LogM8WatchBridge'
  s.version        = '0.1.0'
  s.summary        = 'WatchConnectivity bridge for the LogM8 Apple Watch app'
  s.author         = 'LogM8'
  s.homepage       = 'https://example.invalid/logm8'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'WatchConnectivity'
  s.source_files   = '**/*.swift'
end

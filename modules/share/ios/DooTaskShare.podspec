Pod::Spec.new do |s|
  s.name           = 'DooTaskShare'
  s.version        = '1.0.0'
  s.summary        = 'DooTask 系统分享共享配置'
  s.description    = s.summary
  s.author         = 'DooTask'
  s.license        = 'MIT'
  s.homepage       = 'https://github.com/kuaifan/dootask'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/kuaifan/dootask.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.swift_version = '5.9'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.swift'
  s.resource_bundles = { 'DooTaskShare_privacy' => ['PrivacyInfo.xcprivacy'] }
end

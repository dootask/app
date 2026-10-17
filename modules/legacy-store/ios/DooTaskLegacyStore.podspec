require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name = 'DooTaskLegacyStore'
  s.version = package['version']
  s.summary = package['description']
  s.description = package['description']
  s.license = package['license']
  s.author = 'DooTask'
  s.homepage = 'https://github.com/kuaifan/dootask'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => 'https://github.com/kuaifan/dootask.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.swift_version = '5.9'
  s.source_files = '**/*.swift'
  s.resource_bundles = { 'DooTaskLegacyStore_privacy' => ['PrivacyInfo.xcprivacy'] }
end

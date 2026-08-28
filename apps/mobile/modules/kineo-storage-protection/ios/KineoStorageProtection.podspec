Pod::Spec.new do |s|
  s.name           = 'KineoStorageProtection'
  s.version        = '1.0.0'
  s.summary        = 'Kineo private-storage protection bridge'
  s.description    = 'Creates and verifies Kineo-owned iOS files with Complete Protection and backup exclusion.'
  s.author         = 'Kineo'
  s.homepage       = 'https://github.com/Sasnigs/kineo'
  s.platforms      = {
    :ios => '17.0'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end

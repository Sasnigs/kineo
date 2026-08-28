import { registerWebModule, NativeModule } from 'expo';

// KineoStorageProtectionModule is not available on the web platform.
class KineoStorageProtectionModule extends NativeModule<{}> {}

export default registerWebModule(KineoStorageProtectionModule, 'KineoStorageProtectionModule');

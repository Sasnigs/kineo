import { prototypeContentAssetModules } from '@/infrastructure/content/prototype-content-assets';
import { MigrationFoundationScreen } from '@/ui/screens/migration-foundation-screen';

export default function HomeScreen() {
  return (
    <MigrationFoundationScreen
      bundledContentAssetCount={Object.keys(prototypeContentAssetModules).length}
    />
  );
}

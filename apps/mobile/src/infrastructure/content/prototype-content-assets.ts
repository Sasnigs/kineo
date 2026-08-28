import prototypePlaceholderAsset from '../../../assets/content/prototype-placeholder.svg';

import { prototypeCatalogAsset } from '@/core/content/prototype-routine-catalog';

export const prototypeContentAssetModules: Readonly<Record<string, number>> =
  Object.freeze({
    [prototypeCatalogAsset.localBundlePath]: prototypePlaceholderAsset,
  });

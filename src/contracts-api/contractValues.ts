export const StreamType = {
  Composed: "composed",
  Primitive: "primitive",
} as const;
export type StreamType = (typeof StreamType)[keyof typeof StreamType];

export const MetadataKey = {
  ReadonlyKey: "readonly_key",
  StreamOwner: "stream_owner",
  TypeKey: "type",
  ComposeVisibilityKey: "compose_visibility",
  ReadVisibilityKey: "read_visibility",
  AllowReadWalletKey: "allow_read_wallet",
  AllowComposeStreamKey: "allow_compose_stream",
  AllowZerosKey: "allow_zeros",
} as const;
export type MetadataKey = (typeof MetadataKey)[keyof typeof MetadataKey];

/**
 * Keys that may NOT flow through the generic setMetadata helper. They
 * have dedicated mutators (e.g. setAllowZeros for AllowZerosKey) that
 * own the disable-then-insert sequence atomically. Routing these
 * through insert_metadata would let two parallel "latest" rows coexist
 * and break the per-stream lookup that insert_records and
 * helper_enqueue_prune_days rely on. The node-side action enforces
 * this; the type-level constraint is for friendlier compile errors.
 */
export const RESERVED_METADATA_KEYS = [MetadataKey.AllowZerosKey] as const;
export type ReservedMetadataKey = (typeof RESERVED_METADATA_KEYS)[number];

/** MetadataKey union with reserved keys removed — accepted by setMetadata. */
export type MutableMetadataKey = Exclude<MetadataKey, ReservedMetadataKey>;

export function isReservedMetadataKey(key: MetadataKey): key is ReservedMetadataKey {
  return (RESERVED_METADATA_KEYS as readonly MetadataKey[]).includes(key);
}

export const MetadataType = {
  Int: "int",
  Bool: "bool",
  Float: "float",
  String: "string",
  Ref: "ref",
} as const;
export type MetadataType = (typeof MetadataType)[keyof typeof MetadataType];

export const MetadataTableKey = {
  [MetadataType.Int]: "value_i",
  [MetadataType.Bool]: "value_b",
  [MetadataType.Float]: "value_f",
  [MetadataType.String]: "value_s",
  [MetadataType.Ref]: "value_ref",
} as const satisfies Record<MetadataType, string>;

export const MetadataKeyValueMap = {
  [MetadataKey.ReadonlyKey]: MetadataType.Bool,
  [MetadataKey.StreamOwner]: MetadataType.Ref,
  [MetadataKey.TypeKey]: MetadataType.String,
  [MetadataKey.ComposeVisibilityKey]: MetadataType.Int,
  [MetadataKey.ReadVisibilityKey]: MetadataType.Int,
  [MetadataKey.AllowReadWalletKey]: MetadataType.Ref,
  [MetadataKey.AllowComposeStreamKey]: MetadataType.Ref,
  [MetadataKey.AllowZerosKey]: MetadataType.Bool,
} as const satisfies Record<MetadataKey, MetadataType>;

type MetadataValueMap = {
  [MetadataType.Int]: string;
  [MetadataType.Bool]: boolean;
  [MetadataType.Float]: string;
  [MetadataType.String]: string;
  [MetadataType.Ref]: string;
};

export type MetadataValueTypeForKey<K extends MetadataKey> =
  MetadataValueMap[(typeof MetadataKeyValueMap)[K]];

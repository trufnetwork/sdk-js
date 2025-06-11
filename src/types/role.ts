import { EthereumAddress } from "../util/EthereumAddress";

// Represents the owner of a role: either the literal network owner "system" or an Ethereum address
export type OwnerIdentifier = "system" | EthereumAddress;

export interface GrantRoleInput {
  owner: OwnerIdentifier;
  roleName: string;
  wallets: EthereumAddress[];
}

export interface RevokeRoleInput {
  owner: OwnerIdentifier;
  roleName: string;
  wallets: EthereumAddress[];
}

export interface AreMembersOfInput {
  owner: OwnerIdentifier;
  roleName: string;
  wallets: EthereumAddress[];
}

export interface WalletMembership {
  wallet: string; // lower-cased wallet address
  isMember: boolean;
}

// Input parameters for listing role members with pagination
export interface ListRoleMembersInput {
  owner: OwnerIdentifier;
  roleName: string;
  limit?: number;  // max records to return (defaults enforced in SQL)
  offset?: number; // offset for pagination (defaults enforced in SQL)
}

// The shape of a role member record as returned by list_role_members.
export interface RoleMember {
  wallet: string;      // Wallet address in lowercase
  grantedAt: number;   // Block height when granted
  grantedBy: string;   // Wallet address that performed the grant
} 
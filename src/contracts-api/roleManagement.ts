import { KwilSigner, NodeKwil, Utils, WebKwil, Types } from "@trufnetwork/kwil-js";
import { Action } from "./action";
import { AreMembersOfInput, GrantRoleInput, RevokeRoleInput, WalletMembership } from "../types/role";
import { OwnerIdentifier } from "../types/role";
import { EthereumAddress } from "../util/EthereumAddress";

// Use kwil-js DataType directly
const DataType = Utils.DataType;

/**
 * RoleManagement provides convenient wrappers around the on-chain SQL actions
 * that implement the RBAC system (grant_roles, revoke_roles, are_members_of).
 */
export class RoleManagement extends Action {
  constructor(kwilClient: WebKwil | NodeKwil, kwilSigner: KwilSigner) {
    super(kwilClient, kwilSigner);
  }

  private static normalizeOwner(owner: OwnerIdentifier): string {
    return owner === "system"
      ? "system"
      : owner.getAddress().toLowerCase();
  }

  private static normalizeWallets(wallets: EthereumAddress[]): string[] {
    return wallets.map((w) => w.getAddress().toLowerCase());
  }

  /**
   * Grants a role to the provided wallets.
   * This calls the `grant_roles` action.
   */
  public async grantRole(
    input: GrantRoleInput,
    synchronous = false,
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    return this.executeWithActionBody(
      {
        namespace: "main",
        name: "grant_roles",
        inputs: [
          {
            $owner: RoleManagement.normalizeOwner(input.owner),
            $role_name: input.roleName.toLowerCase(),
            $wallets: RoleManagement.normalizeWallets(input.wallets),
          },
        ],
        types: {
          $owner: DataType.Text,
          $role_name: DataType.Text,
          $wallets: DataType.TextArray,
        },
      },
      synchronous,
    );
  }

  /**
   * Revokes a role from the provided wallets.
   * This calls the `revoke_roles` action.
   */
  public async revokeRole(
    input: RevokeRoleInput,
    synchronous = false,
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    return this.executeWithActionBody(
      {
        namespace: "main",
        name: "revoke_roles",
        inputs: [
          {
            $owner: RoleManagement.normalizeOwner(input.owner),
            $role_name: input.roleName.toLowerCase(),
            $wallets: RoleManagement.normalizeWallets(input.wallets),
          },
        ],
        types: {
          $owner: DataType.Text,
          $role_name: DataType.Text,
          $wallets: DataType.TextArray,
        },
      },
      synchronous,
    );
  }

  /**
   * Checks if the provided wallets are members of a role.
   * This calls the `are_members_of` VIEW action.
   *
   * @returns an array matching the provided wallets order with membership flags.
   */
  public async areMembersOf(
    input: AreMembersOfInput,
  ): Promise<WalletMembership[]> {
    const result = await this.call<{ wallet: string; is_member: boolean }[]>(
      "are_members_of",
      {
        $owner: RoleManagement.normalizeOwner(input.owner),
        $role_name: input.roleName.toLowerCase(),
        $wallets: RoleManagement.normalizeWallets(input.wallets),
      },
    );

    // Either.throw() will return the right value or throw with the left value (status code)
    return result.throw().map((row) => ({
      wallet: row.wallet,
      isMember: row.is_member,
    }));
  }

  /**
   * Lists the members of a role with optional pagination.
   * This calls the `list_role_members` VIEW action.
   */
  public async listRoleMembers(
    input: import("../types/role").ListRoleMembersInput,
  ): Promise<import("../types/role").RoleMember[]> {
    const result = await this.call<{
      wallet: string;
      granted_at: number;
      granted_by: string;
    }[]>("list_role_members", {
      $owner: RoleManagement.normalizeOwner(input.owner),
      $role_name: input.roleName.toLowerCase(),
      ...(input.limit !== undefined ? { $limit: input.limit } : {}),
      ...(input.offset !== undefined ? { $offset: input.offset } : {}),
    });

    return result.throw().map((row) => ({
      wallet: row.wallet,
      grantedAt: Number(row.granted_at),
      grantedBy: row.granted_by,
    }));
  }

  /**
   * Helper factory mirroring the pattern used by the other action wrappers.
   */
  public static fromClient(
    kwilClient: WebKwil | NodeKwil,
    kwilSigner: KwilSigner,
  ): RoleManagement {
    return new RoleManagement(kwilClient, kwilSigner);
  }
} 
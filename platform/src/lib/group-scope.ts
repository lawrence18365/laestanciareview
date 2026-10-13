import { eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { restaurants } from '@/db/schema';

/**
 * Restaurant-group scoping for every owner/regional view, digest and
 * escalation fan-out.
 *
 * `restaurants.group_key` names the group an account belongs to
 * ('grupo-estancia'). NULL means "its own island" (self-serve trials): it is
 * never inside any group's scope, and an owner/regional account whose own
 * group_key is NULL sees nothing. FAIL CLOSED: NULL never matches NULL.
 */

/** In-memory form of the rule: both keys present and equal. */
export function sameGroup(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return typeof a === 'string' && a !== '' && a === b;
}

/** SQL form of the rule. A missing viewer key matches no row at all. */
export function inGroup(groupKey: string | null | undefined): SQL {
  return groupKey ? eq(restaurants.groupKey, groupKey) : sql`false`;
}

/**
 * Rows keyed by a restaurant id (events, subscriptions) whose account is in the
 * viewer's group. Used where the account itself is an owner/regional row, which
 * the location conditions below deliberately exclude.
 */
export function accountInGroup(column: AnyColumn, groupKey: string | null | undefined): SQL {
  return groupKey
    ? sql`${column} in (select ${restaurants.id} from ${restaurants} where ${restaurants.groupKey} = ${groupKey})`
    : sql`false`;
}

/**
 * Conditions for "the operational locations of this group": not an owner or
 * regional account, and in the viewer's group.
 */
export function groupLocationConditions(groupKey: string | null | undefined): SQL[] {
  return [
    eq(restaurants.isOwner, false),
    eq(restaurants.isRegional, false),
    inGroup(groupKey),
  ];
}

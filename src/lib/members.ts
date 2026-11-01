/**
 * The people in a workspace — offered when assigning a package or signing a
 * sheet. Pure and free of relative imports so `node --test` can load it.
 */

export interface Member {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

export function activePeople(people: Member[]): Member[] {
  return people.filter((person) => person.active);
}

/** Name, or the email while the name is still blank, or a plain placeholder. */
export function personLabel(person: Pick<Member, "name" | "email">): string {
  return person.name.trim() || person.email.trim() || "Unnamed person";
}

import Link from "next/link";

import { LogoutButton } from "./logout-button";

export function AppNavigation({ isAdmin }: { isAdmin: boolean }) {
  return (
    <nav className="app-navigation" aria-label="Main navigation">
      <Link href="/albums">Albums</Link>
      {isAdmin ? <Link href="/admin/users">Users</Link> : null}
      <LogoutButton />
    </nav>
  );
}

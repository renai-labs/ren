# Private spaces: pending

Each person has one private space in each org, and only that person can read it. Private spaces are built.

1. **Usage totals.** An admin sees that another person's private space exists: its name, owner, created date and usage totals. Ren records no usage per space yet, so an admin sees name, owner and created date only. Waits for the usage page ([`../../usage.md`](../../usage.md) §8).
2. **Files spec.** The files spec (`runtime/files/`, not merged yet), decision F6, defines a private space by `space.user_id`. The built model uses `space.kind = 'private'` and `space.owner_user_id`. A person store mounts only in its person's private space.

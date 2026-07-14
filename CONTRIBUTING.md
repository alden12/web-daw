# Contributing to web-daw

Thanks for your interest in contributing! This project is licensed under the
[GNU AGPL-3.0-or-later](LICENSE), and contributions are accepted under the same
license via the Developer Certificate of Origin (DCO) described below.

## Getting started

```bash
yarn             # install dependencies
yarn dev         # start the dev server
yarn test        # run unit tests
yarn test:e2e    # run Playwright end-to-end tests
yarn build       # type-check + production build
yarn lint        # lint
yarn check:server # type-check the Node MCP server
```

Please keep the gates green: `yarn test`, `yarn build`, `yarn lint`, and
`yarn check:server` should all pass before you open a pull request. The coding
conventions live in [CLAUDE.md](CLAUDE.md) and the architecture in
[docs/DESIGN.md](docs/DESIGN.md) - skim both before a substantial change.

## Sign-off: the Developer Certificate of Origin

We use the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO) instead of a CLA. It is a lightweight statement that you wrote, or
otherwise have the right to submit, the code you are contributing.

To certify it, add a `Signed-off-by` line to every commit, which Git adds for
you with the `-s` flag:

```bash
git commit -s -m "Your commit message"
```

This appends a line using your `user.name` and `user.email`:

```
Signed-off-by: Jane Doe <jane@example.com>
```

Use your real name and a reachable email. Pull requests whose commits are not
signed off cannot be merged. To sign off a series of commits you already made,
`git rebase --signoff <base>` will add the line to each.

> Note: this is distinct from PGP commit *signing* (`-S`). The DCO needs only
> the textual `Signed-off-by` line that `-s` (lowercase) adds.

### Developer Certificate of Origin 1.1

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## License headers

New source files should carry a short SPDX header:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Alden Laslett
```

The SPDX identifier is what tooling reads; the full license text lives in
[LICENSE](LICENSE). You do not need to paste the long GPL notice into each file.

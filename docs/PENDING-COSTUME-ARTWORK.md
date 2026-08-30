# Pending Costume Artwork

Production release `2026-08-29.80` contains 28 canonical costume identities with honest placeholders. After merged PR #44, the source candidate for release `2026-08-30.81` contains 21. The seven resolved identities are exact reviewed artwork records in source and are no longer part of this inventory.

All 21 remaining identities are valid list entries; only their exact reviewed artwork is pending. The machine-readable source of truth is [`data/pending-costume-artwork.json`](../data/pending-costume-artwork.json), which records both the production baseline and the source candidate.

## Review Policy

- Serve only artwork individually reviewed from an accepted source and stored locally with SHA-256 provenance.
- Use official Pokémon GO announcements as identity evidence, not as a runtime image host.
- Never copy or serve research-only artwork.
- Do not guess among multiple forms or sizes.
- Newly detected artwork requires review before publication.

## Source Candidate Classification

| Category | Count | Meaning |
| --- | ---: | --- |
| Newly announced | 9 | The identity is confirmed, but the accepted artwork snapshot does not contain it yet. |
| Accepted source missing | 0 | No remaining entry fits this category after the current mapping audit. |
| Mapping ambiguous | 5 | Candidate art exists, but the stored identity does not identify one exact variant. |
| Restricted source only | 7 | Research material identifies art that is not approved for copying or serving. |
| Review pending | 0 | No accepted deterministic mapping remains awaiting review in this inventory. |

## Inventory

| Identity | Category | Candidate decision | Next action |
| --- | --- | --- | --- |
| Pikachu (Cosmog Spacesuit) | Newly announced | Not found in accepted snapshot | Recheck accepted source after refresh. |
| Pikachu (Fossil) | Newly announced | Not found in accepted snapshot | Recheck exact Excavator identity. |
| Pikachu (Gloria) | Mapping ambiguous | Multiple research variants rejected | Obtain authoritative variant evidence. |
| Pikachu (GO Fest 2023) | Mapping ambiguous | Five research variants rejected | Split the generic identity safely. |
| Pikachu (GO Fest 2024) | Mapping ambiguous | Moon/Sun candidates rejected | Resolve which tiara the stored row means. |
| Pikachu (Instinct) | Newly announced | Not found in accepted snapshot | Recheck Team Instinct hat. |
| Pikachu (Jeju) | Restricted source only | Research-only candidate rejected | Wait for an accepted source. |
| Pikachu (Marathon) | Newly announced | Not found in accepted snapshot | Recheck 2026 visor. |
| Pikachu (Mystic) | Newly announced | Not found in accepted snapshot | Recheck Team Mystic hat. |
| Pikachu (Professor Willow's Assistant) | Newly announced | Not found in accepted snapshot | Recheck anniversary costume. |
| Pikachu (Valor) | Newly announced | Not found in accepted snapshot | Recheck Team Valor hat. |
| Pikachu (Victor) | Mapping ambiguous | Multiple research variants rejected | Obtain authoritative variant evidence. |
| Pikachu (Worlds 2026) | Newly announced | Not found in accepted snapshot | Recheck Worlds 2026 art. |
| Teddiursa Witch Hat | Restricted source only | Research-only candidate rejected | Wait for an accepted source. |
| Ursaring Witch Hat | Restricted source only | Research-only candidate rejected | Wait for an accepted source. |
| Galarian Corsola Pink Sunglasses | Newly announced | Not found in accepted snapshot | Recheck 2026 sunglasses art. |
| Slakoth (Night Cap) | Restricted source only | Research-only candidate rejected | Wait for an accepted source. |
| Pumpkaboo (Spooky) | Mapping ambiguous | Four size candidates rejected | Resolve the unsized legacy identity. |
| Noibat Headband | Restricted source only | Research-only candidate rejected | Wait for an accepted source. |
| Noivern Headband | Restricted source only | Research-only candidate rejected | Wait for an accepted source. |
| Ursaluna Witch Hat | Restricted source only | Research-only candidate rejected | Wait for an accepted source. |

These gaps do not block Trusted-User Wave 1. A tester report that a placeholder is mistaken for an unknown Pokémon, broken image, or invalid entry is a product finding and should be triaged with the Wave 1 rubric.

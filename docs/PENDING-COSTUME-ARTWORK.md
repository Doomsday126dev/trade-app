# Pending Costume Artwork

Release `2026-08-29.80` has 28 canonical costume identities with honest placeholders. They remain valid list entries; only their exact reviewed artwork is pending. The machine-readable source of truth is [`data/pending-costume-artwork.json`](../data/pending-costume-artwork.json).

## Review Policy

- Serve only artwork individually reviewed from an accepted source and stored locally with SHA-256 provenance.
- Use official Pokémon GO announcements as identity evidence, not as a runtime image host.
- Never copy or serve research-only artwork.
- Do not guess among multiple forms or sizes.
- Newly detected artwork requires review before publication.

## Classification

| Category | Count | Meaning |
| --- | ---: | --- |
| Newly announced | 9 | The identity is confirmed, but the accepted artwork snapshot does not contain it yet. |
| Accepted source missing | 0 | No remaining entry fits this category after the current mapping audit. |
| Mapping ambiguous | 5 | Candidate art exists, but the stored identity does not identify one exact variant. |
| Restricted source only | 7 | Research material identifies art that is not approved for copying or serving. |
| Review pending | 7 | A deterministic accepted-source mapping is isolated in draft PR #44. |

## Inventory

| Identity | Category | Candidate decision | Next action |
| --- | --- | --- | --- |
| Pikachu (Cosmog Spacesuit) | Newly announced | Not found in accepted snapshot | Recheck accepted source after refresh. |
| Pikachu (Fossil) | Newly announced | Not found in accepted snapshot | Recheck exact Excavator identity. |
| Pikachu (Fragment) | Review pending | Thunderbolt Cap accepted in PR #44 | Review PR independently. |
| Pikachu (Gloria) | Mapping ambiguous | Multiple research variants rejected | Obtain authoritative variant evidence. |
| Pikachu (GO Fest 2023) | Mapping ambiguous | Five research variants rejected | Split the generic identity safely. |
| Pikachu (GO Fest 2024) | Mapping ambiguous | Moon/Sun candidates rejected | Resolve which tiara the stored row means. |
| Pikachu (Halloween 2022) | Review pending | Halloween Mischief accepted in PR #44 | Review PR independently. |
| Pikachu (Halloween 2024) | Review pending | Witch Hat accepted in PR #44 | Review PR independently. |
| Pikachu (Holiday 2022) | Review pending | Winter Carnival accepted in PR #44 | Review PR independently. |
| Pikachu (Holiday 2024) | Review pending | Winter Carnival accepted in PR #44 | Review PR independently. |
| Pikachu (Instinct) | Newly announced | Not found in accepted snapshot | Recheck Team Instinct hat. |
| Pikachu (Jeju) | Restricted source only | Research-only candidate rejected | Wait for an accepted source. |
| Pikachu (Marathon) | Newly announced | Not found in accepted snapshot | Recheck 2026 visor. |
| Pikachu (Mystic) | Newly announced | Not found in accepted snapshot | Recheck Team Mystic hat. |
| Pikachu (Professor Willow's Assistant) | Newly announced | Not found in accepted snapshot | Recheck anniversary costume. |
| Pikachu (Valor) | Newly announced | Not found in accepted snapshot | Recheck Team Valor hat. |
| Pikachu (Victor) | Mapping ambiguous | Multiple research variants rejected | Obtain authoritative variant evidence. |
| Pikachu (Worlds 2026) | Newly announced | Not found in accepted snapshot | Recheck Worlds 2026 art. |
| Raichu Fragment Cap | Review pending | Thunderbolt Cap accepted in PR #44 | Review PR independently. |
| Gengar (Halloween 2024) | Review pending | Spooky Festival accepted in PR #44 | Review PR independently. |
| Teddiursa Witch Hat | Restricted source only | Research-only candidate rejected | Wait for an accepted source. |
| Ursaring Witch Hat | Restricted source only | Research-only candidate rejected | Wait for an accepted source. |
| Galarian Corsola Pink Sunglasses | Newly announced | Not found in accepted snapshot | Recheck 2026 sunglasses art. |
| Slakoth (Night Cap) | Restricted source only | Research-only candidate rejected | Wait for an accepted source. |
| Pumpkaboo (Spooky) | Mapping ambiguous | Four size candidates rejected | Resolve the unsized legacy identity. |
| Noibat Headband | Restricted source only | Research-only candidate rejected | Wait for an accepted source. |
| Noivern Headband | Restricted source only | Research-only candidate rejected | Wait for an accepted source. |
| Ursaluna Witch Hat | Restricted source only | Research-only candidate rejected | Wait for an accepted source. |

These gaps do not block Trusted-User Wave 1. A tester report that a placeholder is mistaken for an unknown Pokémon, broken image, or invalid entry is a product finding and should be triaged with the Wave 1 rubric.

// Deliberately pure, fixture-only model. No identity, network, or persistence calls.
export function intentKey(p) {
  return JSON.stringify([p.no, p.name, !!p.shiny, p.bg || "", p.gender || "", p.max || ""]);
}
export function mergeDeclarations(entries) {
  const unique = new Map();
  for (const p of entries) {
    const key = intentKey(p), previous = unique.get(key);
    unique.set(key, previous ? { ...previous, want: previous.want || p.want, offer: previous.offer || p.offer, top: previous.top || p.top } : { ...p });
  }
  return [...unique.values()];
}
export function satisfies(want, offer) {
  if (
    want.no !== offer.no ||
    want.name !== offer.name ||
    Boolean(want.shiny) !== Boolean(offer.shiny)
  )
    return false;
  if ((want.max || "") !== (offer.max || "")) return false;
  if (want.gender && want.gender !== offer.gender) return false;
  if (want.bg === "any") return Boolean(offer.bg && offer.bg !== "any");
  return (want.bg || "") === (offer.bg || "");
}
export function matches(mine, theirs) {
  const intersection = (wants, offers) =>
    wants.filter((w) => offers.some((o) => satisfies(w, o)));
  const wants = mine.filter((p) => p.want),
    offers = mine.filter((p) => p.offer);
  return {
    receive: intersection(
      wants,
      theirs.filter((p) => p.offer),
    ),
    give: intersection(
      theirs.filter((p) => p.want),
      offers,
    ),
    uncertain: wants.filter(
      (w) =>
        w.bg &&
        w.bg !== "any" &&
        theirs.some((o) => o.offer && o.no === w.no && o.bg === "any"),
    ),
  };
}
export function speciesQuery(items, locale = "en") {
  if (!items.length) return "";
  return window.PogoDomain.pokemonGoSearchSyntax.serializeQuery(
    {
      profile: "canonical",
      excludeTraded: true,
      dexNumbers: items.map((p) => p.no),
    },
    locale,
  );
}

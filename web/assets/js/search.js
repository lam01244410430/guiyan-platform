/* Guiyan client search — Wave 4 #14, port of zhou guiyan-demo/src/search.js
   (client-side only). matchesSearch() + the 6 alias groups (14
   words, kept as-is: Guangxi culture vocabulary matching Lam's data) + the
   13-word lexicon. The lexicon is only used to split query tokens; five of
   its words (织锦 / 抛绣球 / 民歌 / 非物质文化遗产 / 文化创意) do not occur
   in Lam's data, but they are kept — splitting on an absent word invents
   no data. Plain JS (no JSX) so node:test can import it directly.
   Haystack for Lam: name + city + catZh(category) + description (current
   language) + tags. Tags come from APIRES (see App.jsx); a resource that
   only exists in the offline fallback catalog simply has no tags here.
   R6-4: matchesSearch(resource, query, filters) also takes price
   (yuan) / rating / region filters with exactly the server's rules
   (GET /api/resources ?min_price=&max_price=&min_rating=&region=):
   min > max counts as no price filter (Wave 4 #14 Q8); a rating filter
   needs a real approved rating — a resource with no reviews (or no
   rating at all) never matches while one is active (same Q8 rule);
   region is the city alias. Client filtering only applies to the
   already-loaded list, never replaces the server query. */
const aliases = [
  ["壮锦", "织锦", "织造"],
  ["绣球", "抛绣球"],
  ["山歌", "民歌"],
  ["非遗", "非物质文化遗产"],
  ["文创", "文化创意"],
  ["场馆", "场地", "剧场"],
];
const lexicon = [
  ...new Set([
    ...aliases.flat(),
    "南宁",
    "柳州",
    "桂林",
    "北海",
    "崇左",
    "河池",
    "演出",
    "音乐会",
    "亲子",
    "设备",
    "艺人",
    "租赁",
    "体验",
  ]),
].sort((a, b) => b.length - a.length);
const splitWords = new RegExp("(" + lexicon.join("|") + ")", "g");
export function matchesSearch(resource, query, filters) {
  // R6-4 filters (all optional; absent fields mean "no filter").
  // resource.price is yuan (the H5 RES tuple price), resource.rating /
  // resource.reviewCount come from APIRES (approved-only, like the
  // server); a caller that passes no price/rating simply gets no
  // filtering on that axis.
  const opts = filters || {};
  const minPrice = Number(opts.minPrice);
  const maxPrice = Number(opts.maxPrice);
  const priceOff =
    !Number.isNaN(minPrice) && !Number.isNaN(maxPrice) && minPrice > maxPrice;
  if (!priceOff) {
    const price = Number(resource.price);
    if (!Number.isNaN(minPrice) && !Number.isNaN(price) && price < minPrice)
      return false;
    if (!Number.isNaN(maxPrice) && !Number.isNaN(price) && price > maxPrice)
      return false;
  }
  const minRating = Number(opts.minRating);
  if (!Number.isNaN(minRating) && minRating > 0) {
    const rating = Number(resource.rating);
    if (!resource.reviewCount || Number.isNaN(rating) || rating < minRating)
      return false;
  }
  const region = opts.region;
  if (region && region !== "all" && resource.city !== region) return false;
  const text = [
    resource.name,
    resource.description,
    resource.city,
    resource.category,
    ...(resource.tags || []),
  ]
    .join(" ")
    .toLowerCase();
  const tokens = String(query || "")
    .trim()
    .toLowerCase()
    .split(/[\s,，、;；]+/)
    .flatMap((token) =>
      text.includes(token) ? [token] : token.split(splitWords).filter(Boolean),
    );
  return tokens.every((token) => {
    const group = aliases.find((g) => g.includes(token));
    return (group || [token]).some((word) => text.includes(word));
  });
}

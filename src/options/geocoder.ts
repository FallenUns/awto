const ENDPOINT = "https://nominatim.openstreetmap.org/search";

export interface AddressResult {
  displayName: string;
  addressLine1: string;
  suburb: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  raw: unknown;
}

interface NominatimItem {
  display_name?: unknown;
  address?: Record<string, unknown>;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function joinLine1(addr: Record<string, unknown>): string {
  const house = asString(addr.house_number);
  const road = asString(addr.road) || asString(addr.pedestrian) || asString(addr.footway);
  if (house && road) return `${house} ${road}`.trim();
  return road || house;
}

function mapItem(item: NominatimItem): AddressResult {
  const addr = item.address ?? {};
  return {
    displayName: asString(item.display_name),
    addressLine1: joinLine1(addr),
    suburb: asString(addr.suburb) || asString(addr.neighbourhood),
    city: asString(addr.city) || asString(addr.town) || asString(addr.village),
    state: asString(addr.state) || asString(addr.province),
    postcode: asString(addr.postcode),
    country: asString(addr.country),
    raw: item,
  };
}

export async function searchAddresses(
  query: string,
  opts: { signal?: AbortSignal; limit?: number } = {}
): Promise<AddressResult[]> {
  const q = query.trim();
  if (!q) return [];
  const limit = opts.limit ?? 5;
  const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=${limit}`;

  try {
    const res = await fetch(url, { signal: opts.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as NominatimItem[];
    if (!Array.isArray(data)) return [];
    return data.map(mapItem);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return [];
  }
}

import { z } from "zod";

export const ProfileSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  preferredName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  suburb: z.string().optional(),
  state: z.string().optional(),
  postcode: z.string().optional(),
  country: z.string().optional(),
  nationality: z.string().optional(),
  workRights: z.string().optional(),
  custom: z.record(z.string()).default({}),
});

export type Profile = z.infer<typeof ProfileSchema>;

export const EMPTY_PROFILE: Profile = ProfileSchema.parse({});

export const BUILT_IN_KEYS = [
  "firstName",
  "lastName",
  "preferredName",
  "email",
  "phone",
  "dateOfBirth",
  "addressLine1",
  "addressLine2",
  "suburb",
  "state",
  "postcode",
  "country",
  "nationality",
  "workRights",
] as const;

export type BuiltInKey = (typeof BUILT_IN_KEYS)[number];

const BUILT_IN_KEY_SET: ReadonlySet<string> = new Set<string>(BUILT_IN_KEYS);

export function isBuiltInKey(key: string): key is BuiltInKey {
  return BUILT_IN_KEY_SET.has(key);
}

export function profileKeys(profile: Profile): string[] {
  const keys: string[] = [];
  for (const key of BUILT_IN_KEYS) {
    if (profile[key] !== undefined) keys.push(key);
  }
  for (const key of Object.keys(profile.custom)) {
    keys.push(key);
  }
  return keys;
}

export function getProfileValue(
  profile: Profile,
  key: string
): string | undefined {
  if (isBuiltInKey(key)) return profile[key];
  return profile.custom[key];
}

export function setProfileValue(
  profile: Profile,
  key: string,
  value: string
): Profile {
  if (isBuiltInKey(key)) {
    return { ...profile, [key]: value };
  }
  return {
    ...profile,
    custom: { ...profile.custom, [key]: value },
  };
}

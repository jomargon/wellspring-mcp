// Withings measure-type and category registries, extracted from the OpenAPI
// spec at developer.withings.com (2026-07). Pure data — the unit kind drives
// which dual-unit helper renders each value (see tools/get-body-measurements).

export type MeasureUnitKind =
	| "kg"
	| "percent"
	| "mmHg"
	| "bpm"
	| "height_m"
	| "celsius"
	| "raw";

export interface MeasureTypeSpec {
	id: number;
	label: string;
	unit: MeasureUnitKind;
}

/** Friendly name → Withings meastype. Keys are the tool's `types` vocabulary. */
export const MEASURE_TYPES = {
	weight: { id: 1, label: "Weight", unit: "kg" },
	height: { id: 4, label: "Height", unit: "height_m" },
	fat_free_mass: { id: 5, label: "Fat-free mass", unit: "kg" },
	fat_ratio: { id: 6, label: "Fat ratio", unit: "percent" },
	fat_mass: { id: 8, label: "Fat mass", unit: "kg" },
	diastolic_bp: { id: 9, label: "Diastolic blood pressure", unit: "mmHg" },
	systolic_bp: { id: 10, label: "Systolic blood pressure", unit: "mmHg" },
	heart_rate: { id: 11, label: "Heart rate", unit: "bpm" },
	spo2: { id: 54, label: "SpO2", unit: "percent" },
	body_temperature: { id: 71, label: "Body temperature", unit: "celsius" },
	muscle_mass: { id: 76, label: "Muscle mass", unit: "kg" },
	hydration: { id: 77, label: "Hydration", unit: "kg" },
	bone_mass: { id: 88, label: "Bone mass", unit: "kg" },
	pulse_wave_velocity: { id: 91, label: "Pulse wave velocity", unit: "raw" },
	vo2_max: { id: 123, label: "VO2 max", unit: "raw" },
	visceral_fat: { id: 170, label: "Visceral fat", unit: "raw" },
} as const satisfies Record<string, MeasureTypeSpec>;

export type MeasureTypeName = keyof typeof MEASURE_TYPES;

export const MEASURE_TYPE_NAMES = Object.keys(
	MEASURE_TYPES,
) as MeasureTypeName[];

/** Reverse lookup: Withings meastype id → friendly name. */
export const MEASURE_TYPE_BY_ID = new Map<number, MeasureTypeName>(
	MEASURE_TYPE_NAMES.map((name) => [MEASURE_TYPES[name].id, name]),
);

/** Zero-argument default: weight + body composition (PLAN.md §6 tool 2). */
export const BODY_COMP_DEFAULTS: MeasureTypeName[] = [
	"weight",
	"fat_ratio",
	"fat_mass",
	"muscle_mass",
	"hydration",
	"bone_mass",
];

/** Heart-list `model` ids → device names (spec: heartv2-list). */
export const HEART_DEVICE_MODELS: Record<number, string> = {
	44: "BPM Core",
	91: "Move ECG",
	93: "ScanWatch",
};

/** Workout `category` → name, from the spec's workout_object table. */
export const WORKOUT_CATEGORIES: Record<number, string> = {
	1: "Walk",
	2: "Run",
	3: "Hiking",
	4: "Skating",
	5: "BMX",
	6: "Bicycling",
	7: "Swimming",
	8: "Surfing",
	9: "Kitesurfing",
	10: "Windsurfing",
	11: "Bodyboard",
	12: "Tennis",
	13: "Table tennis",
	14: "Squash",
	15: "Badminton",
	16: "Lift weights",
	17: "Fitness",
	18: "Elliptical",
	19: "Pilates",
	20: "Basket-ball",
	21: "Soccer",
	22: "Football",
	23: "Rugby",
	24: "Volley-ball",
	25: "Waterpolo",
	26: "Horse riding",
	27: "Golf",
	28: "Yoga",
	29: "Dancing",
	30: "Boxing",
	31: "Fencing",
	32: "Wrestling",
	33: "Martial arts",
	34: "Skiing",
	35: "Snowboarding",
	36: "Other",
	128: "No activity",
	187: "Rowing",
	188: "Zumba",
	191: "Baseball",
	192: "Handball",
	193: "Hockey",
	194: "Ice hockey",
	195: "Climbing",
	196: "Ice skating",
	272: "Multi-sport",
	306: "Indoor walk",
	307: "Indoor running",
	308: "Indoor cycling",
	455: "Standup Paddleboarding",
	456: "Padel",
	457: "Gaming",
	490: "Beach volleyball",
	491: "Stair Stepper",
	492: "Skateboarding",
	493: "Parkour",
	494: "Kayaking",
	495: "Canoeing",
	496: "Sailing",
	497: "Fishing",
	498: "Trail Running",
	499: "Snowshoeing",
	500: "Paintball",
	501: "Archery",
	502: "Scuba Diving",
	503: "Baseball Training",
	504: "Biathlon",
	505: "Bocce",
	506: "Pétanque",
	507: "Paragliding",
	508: "Frisbee",
	509: "Skydiving",
	510: "Pickleball",
	511: "Cornhole",
	512: "Dodgeball",
	513: "Ultimate",
	514: "Teqball",
	515: "Pushing a Wheelchair (Running Pace)",
	516: "Pushing a Wheelchair (Walking Pace)",
	517: "Athletics",
	518: "Track Cycling",
	519: "Pentathlon",
	520: "Sport Shooting",
	521: "Triathlon",
	522: "Diving",
	523: "Mountain Biking",
	524: "Gravel Biking",
	525: "E-Biking",
	526: "E-Mountain Biking",
	527: "Handcycling",
	528: "Velomobile",
	529: "Backcountry Skiing",
	530: "Nordic Skiing",
	531: "Roller Skiing",
	532: "Racquetball",
	534: "Hip Hop",
	535: "Muaythai",
	536: "Taekwondo",
	537: "Judo",
	538: "Trampoline",
	539: "Standing Frame",
	540: "Seated Strength",
	541: "Seated Cardio",
	542: "Walk With Walker",
	543: "Walk With Cane",
	544: "Breaking",
	545: "Chores",
	546: "Crossfit",
	547: "Spinclass",
	548: "Cricket",
	549: "Flamenco Dancing",
	550: "HIIT",
	551: "Meditation",
	552: "Stretching",
	553: "Yard Work Gardening",
	554: "Cleaning",
	555: "Public Speaking",
	556: "Spikeball",
	557: "Lacrosse",
	558: "Baby Wearing",
	559: "Dog Walking",
	560: "Breathing exercises",
	561: "Balance Drills",
	562: "Pushing a Stroller",
	563: "Toddler Wearing",
	564: "Bowling",
	565: "Lasertag",
	566: "Nordic Walking",
	567: "Sumo Wrestling",
	568: "Cooking",
};

export function workoutCategoryName(category: number): string {
	return WORKOUT_CATEGORIES[category] ?? `category_${category}`;
}

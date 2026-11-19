/**
 * DEMONSTRATION DATA — every brand, product, retailer, offer and guide below is fictional.
 * Names are invented and chosen not to resemble real trademarks. All records get is_demo = true.
 * Retailer URLs use the reserved .example TLD (RFC 2606).
 *
 * This file is the only place demo data lives (rule 2.2.4).
 */

export const DEMO_SOURCE = {
  sourceName: "Specbase demonstration research",
  sourceType: "manual_research" as const,
  sourceUrl: null,
  providerName: "Specbase (demo)",
  licenseType: "Demonstration data",
  licenseNotes: "Fictional values written for the demo seed. Not derived from any real product.",
  accessMethod: "seed",
  attributionRequired: false,
  usagePermitted: true,
};

/** Fixed verification timestamp so re-seeding does not change anything. */
export const DEMO_VERIFIED_AT = "2026-11-12T10:00:00Z";

export interface SeedCategory {
  slug: string;
  name: string;
  parent?: string;
  description: string;
  icon: string;
  sortOrder: number;
}

export const CATEGORIES: SeedCategory[] = [
  {
    slug: "smartphones",
    name: "Smartphones",
    description: "Phones with structured display, chipset, camera and battery specifications.",
    icon: "smartphone",
    sortOrder: 10,
  },
  {
    slug: "laptops",
    name: "Laptops",
    description: "Portable computers, from ultraportables to workstations.",
    icon: "laptop",
    sortOrder: 20,
  },
  {
    slug: "gaming-laptops",
    name: "Gaming laptops",
    parent: "laptops",
    description: "Laptops with discrete graphics. Inherits every laptop specification.",
    icon: "gamepad-2",
    sortOrder: 21,
  },
  {
    slug: "cpus",
    name: "Processors",
    description: "Desktop and mobile CPUs.",
    icon: "cpu",
    sortOrder: 30,
  },
  {
    slug: "gpus",
    name: "Graphics cards",
    description: "Discrete graphics cards for desktops.",
    icon: "microchip",
    sortOrder: 40,
  },
  {
    slug: "monitors",
    name: "Monitors",
    description: "External displays for work and play.",
    icon: "monitor",
    sortOrder: 50,
  },
  {
    slug: "headphones",
    name: "Headphones",
    description: "Over-ear, on-ear and in-ear headphones.",
    icon: "headphones",
    sortOrder: 60,
  },
];

export interface SeedGroup {
  key: string;
  name: string;
  order: number;
}
export interface SeedDefinition {
  key: string;
  name: string;
  group: string;
  dataType: "text" | "integer" | "decimal" | "boolean" | "date" | "enum" | "multi_select";
  unit?: string;
  filterable?: boolean;
  required?: boolean;
  direction?: "higher_is_better" | "lower_is_better";
  rules?: Record<string, unknown>;
  description?: string;
}

export const SPEC_SCHEMA: Record<string, { groups: SeedGroup[]; definitions: SeedDefinition[] }> = {
  smartphones: {
    groups: [
      { key: "display", name: "Display", order: 10 },
      { key: "performance", name: "Performance", order: 20 },
      { key: "camera", name: "Camera", order: 30 },
      { key: "battery", name: "Battery", order: 40 },
      { key: "software", name: "Software", order: 50 },
    ],
    definitions: [
      {
        key: "screen_size",
        name: "Screen size",
        group: "display",
        dataType: "decimal",
        unit: "in",
        filterable: true,
        required: true,
        rules: { min: 3, max: 10 },
      },
      {
        key: "chipset",
        name: "Chipset",
        group: "performance",
        dataType: "text",
        required: true,
        rules: { maxLength: 120 },
      },
      {
        key: "ram",
        name: "RAM",
        group: "performance",
        dataType: "integer",
        unit: "GB",
        filterable: true,
        required: true,
        direction: "higher_is_better",
        rules: { min: 1, max: 64 },
      },
      {
        key: "storage",
        name: "Storage",
        group: "performance",
        dataType: "integer",
        unit: "GB",
        filterable: true,
        required: true,
        direction: "higher_is_better",
        rules: { min: 8, max: 4000 },
      },
      {
        key: "rear_camera_main",
        name: "Main rear camera",
        group: "camera",
        dataType: "decimal",
        unit: "MP",
        direction: "higher_is_better",
        rules: { min: 1, max: 300 },
      },
      {
        key: "battery_capacity",
        name: "Battery capacity",
        group: "battery",
        dataType: "integer",
        unit: "mAh",
        filterable: true,
        required: true,
        direction: "higher_is_better",
        rules: { min: 500, max: 20000 },
      },
      {
        key: "charging_power",
        name: "Wired charging",
        group: "battery",
        dataType: "integer",
        unit: "W",
        direction: "higher_is_better",
        rules: { min: 1, max: 300 },
      },
      {
        key: "wireless_charging",
        name: "Wireless charging",
        group: "battery",
        dataType: "boolean",
      },
      {
        key: "operating_system",
        name: "Operating system",
        group: "software",
        dataType: "enum",
        filterable: true,
        rules: { options: ["Aster OS", "Meridian OS"] },
      },
    ],
  },
  laptops: {
    groups: [
      { key: "performance", name: "Performance", order: 10 },
      { key: "display", name: "Display", order: 20 },
      { key: "build", name: "Build and battery", order: 30 },
    ],
    definitions: [
      {
        key: "processor",
        name: "Processor",
        group: "performance",
        dataType: "text",
        required: true,
        rules: { maxLength: 120 },
      },
      {
        key: "ram",
        name: "RAM",
        group: "performance",
        dataType: "integer",
        unit: "GB",
        filterable: true,
        required: true,
        direction: "higher_is_better",
        rules: { min: 2, max: 256 },
      },
      {
        key: "storage",
        name: "Storage",
        group: "performance",
        dataType: "integer",
        unit: "GB",
        filterable: true,
        required: true,
        direction: "higher_is_better",
        rules: { min: 16, max: 16000 },
      },
      {
        key: "screen_size",
        name: "Screen size",
        group: "display",
        dataType: "decimal",
        unit: "in",
        filterable: true,
        required: true,
        rules: { min: 10, max: 20 },
      },
      {
        key: "resolution",
        name: "Resolution",
        group: "display",
        dataType: "text",
        rules: { maxLength: 40 },
      },
      {
        key: "refresh_rate",
        name: "Refresh rate",
        group: "display",
        dataType: "integer",
        unit: "Hz",
        filterable: true,
        direction: "higher_is_better",
        rules: { min: 30, max: 500 },
      },
      {
        key: "weight",
        name: "Weight",
        group: "build",
        dataType: "decimal",
        unit: "kg",
        filterable: true,
        required: true,
        direction: "lower_is_better",
        rules: { min: 0.3, max: 6 },
      },
      {
        key: "battery_capacity",
        name: "Battery capacity",
        group: "build",
        dataType: "decimal",
        unit: "Wh",
        direction: "higher_is_better",
        rules: { min: 10, max: 120 },
      },
      { key: "thunderbolt", name: "Thunderbolt-class port", group: "build", dataType: "boolean" },
    ],
  },
  "gaming-laptops": {
    groups: [{ key: "graphics", name: "Graphics", order: 15 }],
    definitions: [
      {
        key: "discrete_gpu",
        name: "Discrete GPU",
        group: "graphics",
        dataType: "text",
        required: true,
        rules: { maxLength: 120 },
      },
      {
        key: "gpu_power",
        name: "GPU power limit",
        group: "graphics",
        dataType: "integer",
        unit: "W",
        filterable: true,
        direction: "higher_is_better",
        rules: { min: 20, max: 250 },
      },
    ],
  },
  cpus: {
    groups: [
      { key: "cores", name: "Cores and clocks", order: 10 },
      { key: "platform", name: "Platform and power", order: 20 },
    ],
    definitions: [
      {
        key: "cores",
        name: "Cores",
        group: "cores",
        dataType: "integer",
        filterable: true,
        required: true,
        direction: "higher_is_better",
        rules: { min: 1, max: 256 },
      },
      {
        key: "threads",
        name: "Threads",
        group: "cores",
        dataType: "integer",
        filterable: true,
        required: true,
        direction: "higher_is_better",
        rules: { min: 1, max: 512 },
      },
      {
        key: "base_clock",
        name: "Base clock",
        group: "cores",
        dataType: "decimal",
        unit: "GHz",
        direction: "higher_is_better",
        rules: { min: 0.5, max: 7 },
      },
      {
        key: "boost_clock",
        name: "Boost clock",
        group: "cores",
        dataType: "decimal",
        unit: "GHz",
        filterable: true,
        direction: "higher_is_better",
        rules: { min: 0.5, max: 7 },
      },
      {
        key: "tdp",
        name: "TDP",
        group: "platform",
        dataType: "integer",
        unit: "W",
        filterable: true,
        direction: "lower_is_better",
        rules: { min: 1, max: 500 },
      },
      {
        key: "socket",
        name: "Socket",
        group: "platform",
        dataType: "enum",
        filterable: true,
        required: true,
        rules: { options: ["CV5", "CV6", "HD2", "BGA (soldered)"] },
      },
    ],
  },
  gpus: {
    groups: [
      { key: "chip", name: "Chip and memory", order: 10 },
      { key: "board", name: "Board", order: 20 },
    ],
    definitions: [
      {
        key: "architecture",
        name: "Architecture",
        group: "chip",
        dataType: "text",
        required: true,
        rules: { maxLength: 80 },
      },
      {
        key: "vram",
        name: "Video memory",
        group: "chip",
        dataType: "integer",
        unit: "GB",
        filterable: true,
        required: true,
        direction: "higher_is_better",
        rules: { min: 1, max: 128 },
      },
      {
        key: "memory_type",
        name: "Memory type",
        group: "chip",
        dataType: "enum",
        filterable: true,
        rules: { options: ["GDDR6", "GDDR6X", "GDDR7", "HBM3"] },
      },
      {
        key: "memory_bus",
        name: "Memory bus",
        group: "chip",
        dataType: "integer",
        unit: "bit",
        direction: "higher_is_better",
        rules: { min: 32, max: 8192 },
      },
      {
        key: "board_power",
        name: "Board power",
        group: "board",
        dataType: "integer",
        unit: "W",
        filterable: true,
        required: true,
        direction: "lower_is_better",
        rules: { min: 10, max: 1000 },
      },
      {
        key: "interface",
        name: "Interface",
        group: "board",
        dataType: "text",
        rules: { maxLength: 40 },
      },
      {
        key: "length",
        name: "Card length",
        group: "board",
        dataType: "integer",
        unit: "mm",
        filterable: true,
        rules: { min: 50, max: 450 },
      },
    ],
  },
  monitors: {
    groups: [
      { key: "panel", name: "Panel", order: 10 },
      { key: "image", name: "Image", order: 20 },
    ],
    definitions: [
      {
        key: "screen_size",
        name: "Screen size",
        group: "panel",
        dataType: "decimal",
        unit: "in",
        filterable: true,
        required: true,
        rules: { min: 10, max: 100 },
      },
      {
        key: "resolution",
        name: "Resolution",
        group: "panel",
        dataType: "text",
        required: true,
        rules: { maxLength: 40 },
      },
      {
        key: "panel_type",
        name: "Panel type",
        group: "panel",
        dataType: "enum",
        filterable: true,
        required: true,
        rules: { options: ["IPS", "VA", "OLED", "TN"] },
      },
      {
        key: "refresh_rate",
        name: "Refresh rate",
        group: "image",
        dataType: "integer",
        unit: "Hz",
        filterable: true,
        required: true,
        direction: "higher_is_better",
        rules: { min: 24, max: 1000 },
      },
      {
        key: "response_time",
        name: "Response time (GtG)",
        group: "image",
        dataType: "decimal",
        unit: "ms",
        direction: "lower_is_better",
        rules: { min: 0.01, max: 50 },
      },
      {
        key: "brightness",
        name: "Typical brightness",
        group: "image",
        dataType: "integer",
        unit: "nits",
        direction: "higher_is_better",
        rules: { min: 50, max: 5000 },
      },
      {
        key: "hdr_support",
        name: "HDR support",
        group: "image",
        dataType: "boolean",
        filterable: true,
      },
    ],
  },
  headphones: {
    groups: [
      { key: "design", name: "Design", order: 10 },
      { key: "audio", name: "Audio", order: 20 },
      { key: "battery", name: "Battery and connectivity", order: 30 },
    ],
    definitions: [
      {
        key: "form_factor",
        name: "Form factor",
        group: "design",
        dataType: "enum",
        filterable: true,
        required: true,
        rules: { options: ["Over-ear", "On-ear", "In-ear"] },
      },
      {
        key: "weight",
        name: "Weight",
        group: "design",
        dataType: "integer",
        unit: "g",
        direction: "lower_is_better",
        rules: { min: 1, max: 1000 },
      },
      {
        key: "driver_size",
        name: "Driver size",
        group: "audio",
        dataType: "decimal",
        unit: "mm",
        rules: { min: 4, max: 120 },
      },
      {
        key: "noise_cancelling",
        name: "Active noise cancelling",
        group: "audio",
        dataType: "boolean",
        filterable: true,
      },
      {
        key: "battery_life",
        name: "Battery life",
        group: "battery",
        dataType: "decimal",
        unit: "h",
        filterable: true,
        direction: "higher_is_better",
        rules: { min: 1, max: 200 },
      },
      {
        key: "connectivity",
        name: "Connectivity",
        group: "battery",
        dataType: "multi_select",
        filterable: true,
        required: true,
        rules: { options: ["Bluetooth", "USB-C audio", "3.5 mm jack"] },
      },
    ],
  },
};

export const BRANDS = [
  {
    slug: "halden",
    name: "Halden",
    countryOfOrigin: "NO",
    aliases: ["Halden Systems"],
    description: "Fictional maker of laptops, processors and displays.",
  },
  {
    slug: "novik",
    name: "Novik",
    countryOfOrigin: "FI",
    aliases: ["Novik Mobile"],
    description: "Fictional maker of phones, laptops and headphones.",
  },
  {
    slug: "corvala",
    name: "Corvala",
    countryOfOrigin: "PT",
    aliases: ["Corvala Semi"],
    description: "Fictional maker of processors, graphics cards and gaming laptops.",
  },
  {
    slug: "quillon",
    name: "Quillon",
    countryOfOrigin: "NL",
    aliases: [],
    description: "Fictional maker of monitors and headphones.",
  },
];

export const FAMILIES = [
  { brand: "novik", category: "smartphones", slug: "aera", name: "Aera" },
  { brand: "halden", category: "laptops", slug: "vanta", name: "Vanta" },
  { brand: "corvala", category: "gpus", slug: "ridge", name: "Ridge" },
  { brand: "quillon", category: "monitors", slug: "vista", name: "Vista" },
];

type Status = "announced" | "active" | "discontinued" | "unknown";
type Verification = "needs_review" | "partially_verified" | "verified";

export interface SeedVariant {
  code: string;
  name: string;
  region?: string;
  color?: string;
  memory?: string;
  storage?: string;
  /** 12-digit GTIN-13 body in the GS1 internal-use range (20-29); the check digit is computed. */
  gtinBody?: string;
  isDefault?: boolean;
  /** Variant-level overrides of product specs. */
  specs?: Record<string, string | number | boolean | string[]>;
}

export interface SeedProduct {
  slug: string;
  brand: string;
  category: string;
  family?: string;
  name: string;
  modelNumber: string;
  mpn?: string;
  releaseDate?: string;
  announcedDate?: string;
  discontinuedDate?: string;
  status: Status;
  verification: Verification;
  featured?: boolean;
  short: string;
  /** Raw values, deliberately in mixed units ("1 TB", "1390 g") to exercise unit conversion. */
  specs: Record<string, string | number | boolean | string[]>;
  variants?: SeedVariant[];
}

export const PRODUCTS: SeedProduct[] = [
  // ── Smartphones ──
  {
    slug: "aera-6-pro",
    brand: "novik",
    category: "smartphones",
    family: "aera",
    name: "Aera 6 Pro",
    modelNumber: "NA6P-2509",
    releaseDate: "2025-03-11",
    announcedDate: "2025-02-18",
    status: "active",
    verification: "verified",
    short: "The previous Aera flagship, with a 6.6″ OLED panel and 4 800 mAh battery.",
    specs: {
      screen_size: '6.6"',
      chipset: "Novik N2",
      ram: "12 GB",
      storage: "256 GB",
      rear_camera_main: "50 MP",
      battery_capacity: "4 800 mAh",
      charging_power: "33 W",
      wireless_charging: "yes",
      operating_system: "Aster OS",
    },
  },
  {
    slug: "aera-7-pro",
    brand: "novik",
    category: "smartphones",
    family: "aera",
    name: "Aera 7 Pro",
    modelNumber: "NA7P-2611",
    releaseDate: "2026-03-04",
    announcedDate: "2026-02-10",
    status: "active",
    verification: "verified",
    featured: true,
    short: "6.7″ OLED (1–120 Hz), Novik N3 chipset and a 5 000 mAh battery with 45 W charging.",
    specs: {
      screen_size: "6.7 in",
      chipset: "Novik N3",
      ram: "12 GB",
      storage: "256 GB",
      rear_camera_main: "50 MP",
      battery_capacity: "5,000 mAh",
      charging_power: "45 W",
      wireless_charging: true,
      operating_system: "Aster OS",
    },
    variants: [
      {
        code: "256gb-eu",
        name: "256 GB · EU",
        region: "EU",
        storage: "256 GB",
        color: "Graphite",
        gtinBody: "200000000001",
        isDefault: true,
      },
      {
        code: "512gb-eu",
        name: "512 GB · EU",
        region: "EU",
        storage: "512 GB",
        color: "Graphite",
        gtinBody: "200000000002",
        specs: { storage: "512 GB" },
      },
      {
        code: "1tb-us",
        name: "1 TB · US",
        region: "US",
        storage: "1 TB",
        memory: "16 GB",
        color: "Fog",
        gtinBody: "200000000003",
        specs: { storage: "1 TB", ram: "16 GB" },
      },
    ],
  },
  {
    slug: "pocket-3",
    brand: "halden",
    category: "smartphones",
    name: "Pocket 3",
    modelNumber: "HP3-2601",
    releaseDate: "2026-01-20",
    status: "active",
    verification: "partially_verified",
    short: "A compact 5.9″ phone. Charging and camera values still awaiting a second source.",
    specs: {
      screen_size: "5.9 in",
      chipset: "Halden H3 Mobile",
      ram: "8 GB",
      storage: "128 GB",
      battery_capacity: "4100 mAh",
      wireless_charging: false,
      operating_system: "Meridian OS",
    },
  },
  {
    slug: "strand-s",
    brand: "corvala",
    category: "smartphones",
    name: "Strand S",
    modelNumber: "CSS-2604",
    announcedDate: "2026-10-28",
    status: "announced",
    verification: "needs_review",
    short: "Announced, not yet released. Specifications are preliminary.",
    specs: {
      screen_size: "6.4 in",
      chipset: "Corvala C1",
      storage: "256 GB",
      battery_capacity: "5200 mAh",
    },
  },
  // ── Laptops ──
  {
    slug: "vanta-14-2025",
    brand: "halden",
    category: "laptops",
    family: "vanta",
    name: "Vanta 14 (2025)",
    modelNumber: "HV14-25-H6",
    releaseDate: "2025-04-02",
    discontinuedDate: "2026-04-30",
    status: "discontinued",
    verification: "verified",
    short: "The 2025 Vanta 14 with the Halden H6 chip. Replaced by the 2026 model.",
    specs: {
      processor: "Halden H6",
      ram: "16 GB",
      storage: "512 GB",
      screen_size: '14.2"',
      resolution: "2880 × 1800",
      refresh_rate: "90 Hz",
      weight: "1420 g",
      battery_capacity: "66 Wh",
      thunderbolt: "yes",
    },
  },
  {
    slug: "vanta-14-2026",
    brand: "halden",
    category: "laptops",
    family: "vanta",
    name: "Vanta 14 (2026)",
    modelNumber: "HV14-26-H7P",
    releaseDate: "2026-04-15",
    status: "active",
    verification: "verified",
    featured: true,
    short: "14.2″ 120 Hz display, Halden H7 Pro, 1.39 kg.",
    specs: {
      processor: "Halden H7 Pro",
      ram: "32 GB",
      storage: "1 TB",
      screen_size: '14.2"',
      resolution: "2880 × 1800",
      refresh_rate: "120 Hz",
      weight: "1.39 kg",
      battery_capacity: "72 Wh",
      thunderbolt: true,
    },
    variants: [
      {
        code: "32gb-1tb",
        name: "32 GB · 1 TB",
        memory: "32 GB",
        storage: "1 TB",
        gtinBody: "200000000011",
        isDefault: true,
      },
      {
        code: "16gb-512gb",
        name: "16 GB · 512 GB",
        memory: "16 GB",
        storage: "512 GB",
        gtinBody: "200000000012",
        specs: { ram: "16 GB", storage: "512 GB" },
      },
    ],
  },
  {
    slug: "slate-13",
    brand: "novik",
    category: "laptops",
    name: "Slate 13",
    modelNumber: "NS13-2602",
    releaseDate: "2026-02-24",
    status: "active",
    verification: "partially_verified",
    short: "A 13.3″ fanless ultraportable at 980 g.",
    specs: {
      processor: "Novik N3 Compute",
      ram: "16 GB",
      storage: "512 GB",
      screen_size: "13.3 in",
      resolution: "2560 × 1600",
      refresh_rate: "60 Hz",
      weight: "980 g",
      battery_capacity: "54 Wh",
    },
  },
  {
    slug: "brisk-15",
    brand: "corvala",
    category: "laptops",
    name: "Brisk 15",
    modelNumber: "CB15-2603",
    releaseDate: "2026-03-18",
    status: "active",
    verification: "verified",
    short: "A 15.6″ everyday laptop with a large 80 Wh battery.",
    specs: {
      processor: "Corvala X5 Mobile",
      ram: "16 GB",
      storage: "1 TB",
      screen_size: '15.6"',
      resolution: "1920 × 1080",
      refresh_rate: "144 Hz",
      weight: "1.78 kg",
      battery_capacity: "80 Wh",
      thunderbolt: false,
    },
  },
  {
    slug: "strand-g16",
    brand: "corvala",
    category: "gaming-laptops",
    name: "Strand G16",
    modelNumber: "CSG16-2605",
    releaseDate: "2026-05-06",
    status: "active",
    verification: "partially_verified",
    featured: true,
    short: "16″ 240 Hz gaming laptop with a Corvala Ridge 7600M at up to 140 W.",
    specs: {
      processor: "Corvala X9 Mobile",
      ram: "32 GB",
      storage: "2 TB",
      screen_size: "16 in",
      resolution: "2560 × 1600",
      refresh_rate: "240 Hz",
      weight: "2.45 kg",
      battery_capacity: "90 Wh",
      discrete_gpu: "Corvala Ridge 7600M",
      gpu_power: "140 W",
    },
  },
  // ── CPUs ──
  {
    slug: "x7",
    brand: "corvala",
    category: "cpus",
    name: "X7",
    modelNumber: "CV-X7",
    releaseDate: "2024-10-08",
    status: "active",
    verification: "verified",
    short: "8 cores, 16 threads, up to 5.4 GHz on the CV5 socket.",
    specs: {
      cores: 8,
      threads: 16,
      base_clock: "4.2 GHz",
      boost_clock: "5.4 GHz",
      tdp: "105 W",
      socket: "CV5",
    },
  },
  {
    slug: "x9-3d",
    brand: "corvala",
    category: "cpus",
    name: "X9 3D",
    modelNumber: "CV-X9-3D",
    releaseDate: "2026-01-14",
    status: "active",
    verification: "verified",
    featured: true,
    short: "16 cores with stacked cache, on the new CV6 socket.",
    specs: {
      cores: 16,
      threads: 32,
      base_clock: "4000 MHz",
      boost_clock: "5.6 GHz",
      tdp: "120 W",
      socket: "CV6",
    },
  },
  {
    slug: "forge-8",
    brand: "halden",
    category: "cpus",
    name: "Forge 8",
    modelNumber: "HF8-2600",
    releaseDate: "2026-02-02",
    status: "active",
    verification: "partially_verified",
    short: "Halden's 12-core desktop processor for the HD2 platform.",
    specs: { cores: 12, threads: 24, base_clock: "3.8 GHz", boost_clock: "5.3 GHz", socket: "HD2" },
  },
  // ── GPUs ──
  {
    slug: "ridge-6800",
    brand: "corvala",
    category: "gpus",
    family: "ridge",
    name: "Ridge 6800",
    modelNumber: "CG-6800-12",
    releaseDate: "2024-11-19",
    status: "active",
    verification: "verified",
    short: "12 GB GDDR6 on a 192-bit bus.",
    specs: {
      architecture: "Ridge 2",
      vram: "12 GB",
      memory_type: "GDDR6",
      memory_bus: "192-bit",
      board_power: "220 W",
      interface: "PCIe 4.0 x16",
      length: "28.5 cm",
    },
  },
  {
    slug: "ridge-7800",
    brand: "corvala",
    category: "gpus",
    family: "ridge",
    name: "Ridge 7800",
    modelNumber: "CG-7800-16",
    releaseDate: "2026-02-26",
    status: "active",
    verification: "verified",
    featured: true,
    short: "16 GB GDDR7 on a 256-bit bus at 250 W.",
    specs: {
      architecture: "Ridge 3",
      vram: "16 GB",
      memory_type: "GDDR7",
      memory_bus: "256 bit",
      board_power: "250 W",
      interface: "PCIe 5.0 x16",
      length: "304 mm",
    },
  },
  {
    slug: "tessel-12",
    brand: "halden",
    category: "gpus",
    name: "Tessel 12",
    modelNumber: "HT12-2603",
    releaseDate: "2026-03-31",
    status: "active",
    verification: "partially_verified",
    short: "A compact 12 GB card at 180 W.",
    specs: {
      architecture: "Tessel",
      vram: "12 GB",
      memory_type: "GDDR6",
      memory_bus: "192 bit",
      board_power: "180 W",
      interface: "PCIe 4.0 x8",
    },
  },
  // ── Monitors ──
  {
    slug: "vista-27",
    brand: "quillon",
    category: "monitors",
    family: "vista",
    name: "Vista 27",
    modelNumber: "QV27-A",
    releaseDate: "2024-09-03",
    status: "discontinued",
    discontinuedDate: "2026-01-31",
    verification: "verified",
    short: "27″ 1440p IPS at 165 Hz.",
    specs: {
      screen_size: '27"',
      resolution: "2560 × 1440",
      panel_type: "IPS",
      refresh_rate: "165 Hz",
      response_time: "1 ms",
      brightness: "350 nits",
      hdr_support: false,
    },
  },
  {
    slug: "vista-27-ii",
    brand: "quillon",
    category: "monitors",
    family: "vista",
    name: "Vista 27 II",
    modelNumber: "QV27-B",
    releaseDate: "2026-02-10",
    status: "active",
    verification: "verified",
    short: "The second-generation Vista 27 at 240 Hz with HDR.",
    specs: {
      screen_size: '27"',
      resolution: "2560 × 1440",
      panel_type: "IPS",
      refresh_rate: "240 Hz",
      response_time: "0.5 ms",
      brightness: "400 nits",
      hdr_support: true,
    },
  },
  {
    slug: "lumen-27q",
    brand: "halden",
    category: "monitors",
    name: "Lumen 27Q",
    modelNumber: "HM27-Q240",
    releaseDate: "2026-06-09",
    status: "active",
    verification: "partially_verified",
    featured: true,
    short: "27″ OLED at 240 Hz.",
    specs: {
      screen_size: "27 in",
      resolution: "2560 × 1440",
      panel_type: "OLED",
      refresh_rate: "240 Hz",
      response_time: "0.03 ms",
      hdr_support: true,
    },
  },
  // ── Headphones ──
  {
    slug: "hush-4",
    brand: "novik",
    category: "headphones",
    name: "Hush 4",
    modelNumber: "NK-H4-ANC",
    releaseDate: "2024-08-27",
    status: "active",
    verification: "verified",
    short: "Over-ear noise-cancelling headphones, 30 h battery.",
    specs: {
      form_factor: "Over-ear",
      weight: "268 g",
      driver_size: "40 mm",
      noise_cancelling: true,
      battery_life: "30 h",
      connectivity: ["Bluetooth", "3.5 mm jack"],
    },
  },
  {
    slug: "hush-5",
    brand: "novik",
    category: "headphones",
    name: "Hush 5",
    modelNumber: "NK-H5-ANC",
    releaseDate: "2026-04-21",
    status: "active",
    verification: "verified",
    featured: true,
    short: "Lighter, with 40 h battery and USB-C audio.",
    specs: {
      form_factor: "Over-ear",
      weight: "0.25 kg",
      driver_size: "4 cm",
      noise_cancelling: "yes",
      battery_life: "40 h",
      connectivity: "Bluetooth; USB-C audio; 3.5 mm jack",
    },
  },
  {
    slug: "arden",
    brand: "quillon",
    category: "headphones",
    name: "Arden",
    modelNumber: "QA-OE1",
    releaseDate: "2025-11-04",
    status: "active",
    verification: "partially_verified",
    short: "Wired open-back over-ear headphones.",
    specs: {
      form_factor: "Over-ear",
      weight: "310 g",
      driver_size: "50 mm",
      noise_cancelling: false,
      connectivity: ["3.5 mm jack"],
    },
  },
  {
    slug: "pebble-buds-2",
    brand: "quillon",
    category: "headphones",
    name: "Pebble Buds 2",
    modelNumber: "QPB-2",
    releaseDate: "2026-07-15",
    status: "active",
    verification: "needs_review",
    short: "In-ear buds. Data incomplete; awaiting review.",
    specs: { form_factor: "In-ear", noise_cancelling: true, connectivity: ["Bluetooth"] },
  },
];

/** `successor`: from = older product, to = its successor. */
export const RELATIONSHIPS: { from: string; to: string; type: "successor" | "alternative" }[] = [
  { from: "aera-6-pro", to: "aera-7-pro", type: "successor" },
  { from: "pocket-3", to: "aera-7-pro", type: "alternative" },
  { from: "vanta-14-2025", to: "vanta-14-2026", type: "successor" },
  { from: "vanta-14-2026", to: "slate-13", type: "alternative" },
  { from: "x7", to: "x9-3d", type: "successor" },
  { from: "x9-3d", to: "forge-8", type: "alternative" },
  { from: "ridge-6800", to: "ridge-7800", type: "successor" },
  { from: "ridge-7800", to: "tessel-12", type: "alternative" },
  { from: "vista-27", to: "vista-27-ii", type: "successor" },
  { from: "vista-27-ii", to: "lumen-27q", type: "alternative" },
  { from: "hush-4", to: "hush-5", type: "successor" },
  { from: "hush-5", to: "arden", type: "alternative" },
];

export const RETAILERS = [
  {
    slug: "demo-retailer-pl",
    name: "Demo Retailer PL",
    host: "shop.demo-retailer-pl.example",
    countryCode: "PL",
    currencies: ["PLN"],
  },
  {
    slug: "demo-electro-pl",
    name: "Demo Electro PL",
    host: "www.demo-electro-pl.example",
    countryCode: "PL",
    currencies: ["PLN"],
  },
  {
    slug: "demo-retailer-de",
    name: "Demo Retailer DE",
    host: "shop.demo-retailer-de.example",
    countryCode: "DE",
    currencies: ["EUR"],
  },
  {
    slug: "demo-retailer-us",
    name: "Demo Retailer US",
    host: "shop.demo-retailer-us.example",
    countryCode: "US",
    currencies: ["USD"],
  },
];

export interface SeedOffer {
  retailer: string;
  product: string;
  variant?: string;
  market: string;
  currency: string;
  price: string;
  originalPrice?: string;
  shipping?: string;
  condition: "new" | "used" | "refurbished";
  availability: "in_stock" | "out_of_stock" | "preorder" | "unknown";
  /** Hours before the seed's anchor time (start of the current UTC hour). */
  checkedHoursAgo: number;
  /** Hours relative to the anchor; negative = already expired. */
  expiresInHours?: number;
}

export const OFFERS: SeedOffer[] = [
  // Aera 7 Pro: fresh PL offers (new, refurbished, out of stock), one stale, plus DE/US markets.
  {
    retailer: "demo-electro-pl",
    product: "aera-7-pro",
    variant: "256gb-eu",
    market: "PL",
    currency: "PLN",
    price: "3349.00",
    condition: "refurbished",
    availability: "in_stock",
    checkedHoursAgo: 6,
  },
  {
    retailer: "demo-retailer-pl",
    product: "aera-7-pro",
    variant: "256gb-eu",
    market: "PL",
    currency: "PLN",
    price: "3899.00",
    originalPrice: "4199.00",
    shipping: "0",
    condition: "new",
    availability: "in_stock",
    checkedHoursAgo: 2,
  },
  {
    retailer: "demo-electro-pl",
    product: "aera-7-pro",
    variant: "512gb-eu",
    market: "PL",
    currency: "PLN",
    price: "4449.00",
    condition: "new",
    availability: "out_of_stock",
    checkedHoursAgo: 24,
  },
  {
    retailer: "demo-retailer-pl",
    product: "aera-7-pro",
    variant: "512gb-eu",
    market: "PL",
    currency: "PLN",
    price: "4299.00",
    condition: "new",
    availability: "in_stock",
    checkedHoursAgo: 120,
  },
  {
    retailer: "demo-retailer-de",
    product: "aera-7-pro",
    variant: "256gb-eu",
    market: "DE",
    currency: "EUR",
    price: "899.00",
    shipping: "4.99",
    condition: "new",
    availability: "in_stock",
    checkedHoursAgo: 3,
  },
  {
    retailer: "demo-retailer-us",
    product: "aera-7-pro",
    variant: "1tb-us",
    market: "US",
    currency: "USD",
    price: "1249.00",
    condition: "new",
    availability: "preorder",
    checkedHoursAgo: 10,
  },
  // Vanta 14 (2026)
  {
    retailer: "demo-retailer-pl",
    product: "vanta-14-2026",
    variant: "32gb-1tb",
    market: "PL",
    currency: "PLN",
    price: "6299.00",
    condition: "new",
    availability: "in_stock",
    checkedHoursAgo: 4,
  },
  {
    retailer: "demo-electro-pl",
    product: "vanta-14-2026",
    variant: "16gb-512gb",
    market: "PL",
    currency: "PLN",
    price: "5199.00",
    condition: "new",
    availability: "in_stock",
    checkedHoursAgo: 8,
  },
  {
    retailer: "demo-retailer-de",
    product: "vanta-14-2026",
    variant: "32gb-1tb",
    market: "DE",
    currency: "EUR",
    price: "1499.00",
    condition: "new",
    availability: "in_stock",
    checkedHoursAgo: 30,
  },
  // Expired: must never be displayed.
  {
    retailer: "demo-retailer-us",
    product: "vanta-14-2026",
    variant: "32gb-1tb",
    market: "US",
    currency: "USD",
    price: "1599.00",
    condition: "new",
    availability: "in_stock",
    checkedHoursAgo: 12,
    expiresInHours: -24,
  },
  // Others
  {
    retailer: "demo-retailer-de",
    product: "ridge-7800",
    market: "DE",
    currency: "EUR",
    price: "649.00",
    condition: "new",
    availability: "in_stock",
    checkedHoursAgo: 5,
  },
  {
    retailer: "demo-retailer-us",
    product: "ridge-7800",
    market: "US",
    currency: "USD",
    price: "699.99",
    condition: "new",
    availability: "in_stock",
    checkedHoursAgo: 7,
  },
  {
    retailer: "demo-retailer-pl",
    product: "x9-3d",
    market: "PL",
    currency: "PLN",
    price: "2799.00",
    condition: "new",
    availability: "in_stock",
    checkedHoursAgo: 1,
  },
  {
    retailer: "demo-retailer-pl",
    product: "hush-5",
    market: "PL",
    currency: "PLN",
    price: "1299.00",
    condition: "new",
    availability: "in_stock",
    checkedHoursAgo: 9,
  },
  {
    retailer: "demo-retailer-de",
    product: "hush-4",
    market: "DE",
    currency: "EUR",
    price: "219.00",
    condition: "used",
    availability: "in_stock",
    checkedHoursAgo: 100,
  },
  {
    retailer: "demo-retailer-us",
    product: "vista-27-ii",
    market: "US",
    currency: "USD",
    price: "449.00",
    condition: "new",
    availability: "out_of_stock",
    checkedHoursAgo: 15,
  },
];

export const GUIDES = [
  {
    slug: "how-much-phone-storage",
    title: "How much phone storage do you need?",
    summary: "A practical way to choose between 256 GB, 512 GB and 1 TB configurations.",
    author: "Specbase demo editors",
    publishedAt: "2026-10-02T09:00:00Z",
    products: ["aera-7-pro", "pocket-3"],
    categories: ["smartphones"],
    body: `Storage is the one phone specification you cannot change later.

## Start from what you keep on the device

Photos and video are usually the largest category. If you record video often, plan for more space than you use today.

## Configurations are variants, not separate products

On Specbase, a phone sold in 256 GB and 512 GB configurations is **one product with several variants**. Each variant has its own offers, so prices are never mixed across configurations.

*This guide is demonstration content. The products it mentions are fictional.*`,
  },
  {
    slug: "laptop-weight-vs-battery",
    title: "Laptop weight versus battery capacity",
    summary:
      "Why the lightest laptop is rarely the one with the longest runtime, and how to read the numbers.",
    author: "Specbase demo editors",
    publishedAt: "2026-10-20T09:00:00Z",
    products: ["vanta-14-2026", "slate-13", "brisk-15"],
    categories: ["laptops"],
    body: `Battery capacity is measured in watt-hours (Wh). Larger batteries weigh more.

## Compare like with like

Weight is listed in kilograms with the same precision across products, so differences of 100 g are visible in comparisons.

## Capacity is not runtime

Runtime depends on the display, the processor and how you use the laptop. Specbase lists capacity, which is measurable, rather than estimated hours.

*This guide is demonstration content. The products it mentions are fictional.*`,
  },
];

export const FEATURED_COMPARISONS = [
  { title: "Aera 7 Pro vs Aera 6 Pro", products: ["aera-7-pro", "aera-6-pro"], sortOrder: 10 },
  {
    title: "Ridge 7800 vs Ridge 6800 vs Tessel 12",
    products: ["ridge-7800", "ridge-6800", "tessel-12"],
    sortOrder: 20,
  },
];

import type { SpecDataType, ValidationRules } from "@/modules/specifications/parse";

/**
 * Target categories and their specification sets for the free-data import (DECISIONS D79).
 * Adding a category means adding an entry here and provider mappings — no new code paths.
 * `pnpm catalog:bootstrap` creates whatever is missing; it never changes existing definitions.
 *
 * Choices:
 * - Keys match the demo catalogue where the concept is the same (screen_size, ram, storage, …).
 * - Free-form values that differ between providers (OS, panel type, memory type) are text, not
 *   option lists, so real values are not rejected; option lists are used only for small, stable
 *   vocabularies.
 * - `required` marks the core set used for the 60 % coverage rule (indexability); only values
 *   free sources commonly provide.
 * - `variant` marks the keys that make two configurations different variants (storage, memory).
 * - Provider feature IDs are NOT listed here: they are provider_mappings rows, added with each
 *   adapter after its documentation is checked (Icecat: Stage 4).
 */

export interface DefinitionConfig {
  key: string;
  name: string;
  group: string;
  dataType: SpecDataType;
  unit?: string;
  required?: boolean;
  filterable?: boolean;
  direction?: "higher_is_better" | "lower_is_better" | "none";
  rules?: ValidationRules;
  variant?: "storage" | "memory";
}

export interface CategoryConfig {
  slug: string;
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
  groups: { key: string; name: string; order: number }[];
  definitions: DefinitionConfig[];
}

const higher = "higher_is_better" as const;
const lower = "lower_is_better" as const;

export const TARGET_CATEGORIES: CategoryConfig[] = [
  {
    slug: "smartphones",
    name: "Smartphones",
    description: "Phones with structured display, processor, camera and battery specifications.",
    icon: "smartphone",
    sortOrder: 10,
    groups: [
      { key: "display", name: "Display", order: 10 },
      { key: "performance", name: "Performance", order: 20 },
      { key: "camera", name: "Camera", order: 30 },
      { key: "battery", name: "Battery", order: 40 },
      { key: "software", name: "Software", order: 50 },
      { key: "connectivity", name: "Connectivity", order: 60 },
    ],
    definitions: [
      {
        key: "screen_size",
        name: "Screen size",
        group: "display",
        dataType: "decimal",
        unit: "in",
        required: true,
        filterable: true,
        rules: { min: 2, max: 12 },
      },
      {
        key: "resolution",
        name: "Resolution",
        group: "display",
        dataType: "text",
        rules: { maxLength: 40 },
      },
      {
        key: "display_technology",
        name: "Display technology",
        group: "display",
        dataType: "text",
        rules: { maxLength: 80 },
      },
      {
        key: "chipset",
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
        required: true,
        filterable: true,
        direction: higher,
        rules: { min: 1, max: 64 },
        variant: "memory",
      },
      {
        key: "storage",
        name: "Storage",
        group: "performance",
        dataType: "integer",
        unit: "GB",
        required: true,
        filterable: true,
        direction: higher,
        rules: { min: 4, max: 4096 },
        variant: "storage",
      },
      {
        key: "rear_camera_main",
        name: "Rear camera (main)",
        group: "camera",
        dataType: "decimal",
        unit: "MP",
        filterable: true,
        direction: higher,
        rules: { min: 1, max: 400 },
      },
      {
        key: "front_camera",
        name: "Front camera",
        group: "camera",
        dataType: "decimal",
        unit: "MP",
        direction: higher,
        rules: { min: 0.3, max: 200 },
      },
      {
        key: "battery_capacity",
        name: "Battery capacity",
        group: "battery",
        dataType: "integer",
        unit: "mAh",
        required: true,
        filterable: true,
        direction: higher,
        rules: { min: 300, max: 20000 },
      },
      {
        key: "charging_power",
        name: "Wired charging",
        group: "battery",
        dataType: "integer",
        unit: "W",
        direction: higher,
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
        dataType: "text",
        required: true,
        rules: { maxLength: 80 },
      },
      {
        key: "network_5g",
        name: "5G",
        group: "connectivity",
        dataType: "boolean",
        filterable: true,
      },
      { key: "nfc", name: "NFC", group: "connectivity", dataType: "boolean" },
      {
        key: "wifi_standard",
        name: "Wi-Fi",
        group: "connectivity",
        dataType: "text",
        rules: { maxLength: 80 },
      },
      {
        key: "bluetooth_version",
        name: "Bluetooth",
        group: "connectivity",
        dataType: "text",
        rules: { maxLength: 40 },
      },
    ],
  },
  {
    slug: "laptops",
    name: "Laptops",
    description: "Portable computers, from ultraportables to workstations.",
    icon: "laptop",
    sortOrder: 20,
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
        key: "gpu",
        name: "Graphics",
        group: "performance",
        dataType: "text",
        rules: { maxLength: 120 },
      },
      {
        key: "ram",
        name: "RAM",
        group: "performance",
        dataType: "integer",
        unit: "GB",
        required: true,
        filterable: true,
        direction: higher,
        rules: { min: 1, max: 512 },
        variant: "memory",
      },
      {
        key: "storage",
        name: "Storage",
        group: "performance",
        dataType: "integer",
        unit: "GB",
        required: true,
        filterable: true,
        direction: higher,
        rules: { min: 16, max: 32000 },
        variant: "storage",
      },
      {
        key: "screen_size",
        name: "Screen size",
        group: "display",
        dataType: "decimal",
        unit: "in",
        required: true,
        filterable: true,
        rules: { min: 7, max: 21 },
      },
      {
        key: "resolution",
        name: "Resolution",
        group: "display",
        dataType: "text",
        rules: { maxLength: 40 },
      },
      {
        key: "display_technology",
        name: "Display technology",
        group: "display",
        dataType: "text",
        rules: { maxLength: 80 },
      },
      {
        key: "refresh_rate",
        name: "Refresh rate",
        group: "display",
        dataType: "integer",
        unit: "Hz",
        filterable: true,
        direction: higher,
        rules: { min: 30, max: 500 },
      },
      {
        key: "battery_capacity",
        name: "Battery",
        group: "build",
        dataType: "decimal",
        unit: "Wh",
        direction: higher,
        rules: { min: 10, max: 100 },
      },
      {
        key: "weight",
        name: "Weight",
        group: "build",
        dataType: "decimal",
        unit: "kg",
        required: true,
        filterable: true,
        direction: lower,
        rules: { min: 0.3, max: 6 },
      },
      { key: "ports", name: "Ports", group: "build", dataType: "text", rules: { maxLength: 500 } },
      {
        key: "operating_system",
        name: "Operating system",
        group: "build",
        dataType: "text",
        rules: { maxLength: 80 },
      },
    ],
  },
  {
    slug: "cpus",
    name: "Processors",
    description: "Desktop and mobile CPUs.",
    icon: "cpu",
    sortOrder: 30,
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
        required: true,
        filterable: true,
        direction: higher,
        rules: { min: 1, max: 256 },
      },
      {
        key: "threads",
        name: "Threads",
        group: "cores",
        dataType: "integer",
        required: true,
        filterable: true,
        direction: higher,
        rules: { min: 1, max: 512 },
      },
      {
        key: "base_clock",
        name: "Base frequency",
        group: "cores",
        dataType: "decimal",
        unit: "GHz",
        direction: higher,
        rules: { min: 0.1, max: 10 },
      },
      {
        key: "boost_clock",
        name: "Boost frequency",
        group: "cores",
        dataType: "decimal",
        unit: "GHz",
        filterable: true,
        direction: higher,
        rules: { min: 0.1, max: 10 },
      },
      {
        key: "cache",
        name: "Cache (L3)",
        group: "cores",
        dataType: "integer",
        unit: "MB",
        direction: higher,
        rules: { min: 1, max: 2048 },
      },
      {
        key: "socket",
        name: "Socket",
        group: "platform",
        dataType: "text",
        required: true,
        filterable: false,
        rules: { maxLength: 40 },
      },
      {
        key: "tdp",
        name: "TDP",
        group: "platform",
        dataType: "integer",
        unit: "W",
        filterable: true,
        direction: lower,
        rules: { min: 1, max: 1000 },
      },
      {
        key: "architecture",
        name: "Architecture",
        group: "platform",
        dataType: "text",
        rules: { maxLength: 80 },
      },
      {
        key: "integrated_graphics",
        name: "Integrated graphics",
        group: "platform",
        dataType: "text",
        rules: { maxLength: 120 },
      },
    ],
  },
  {
    slug: "gpus",
    name: "Graphics cards",
    description: "Desktop graphics cards.",
    icon: "microchip",
    sortOrder: 40,
    groups: [
      { key: "chip", name: "Chip and memory", order: 10 },
      { key: "board", name: "Board", order: 20 },
    ],
    definitions: [
      {
        key: "chipset",
        name: "GPU",
        group: "chip",
        dataType: "text",
        required: true,
        rules: { maxLength: 120 },
      },
      {
        key: "vram",
        name: "Video memory",
        group: "chip",
        dataType: "integer",
        unit: "GB",
        required: true,
        filterable: true,
        direction: higher,
        rules: { min: 1, max: 256 },
      },
      {
        key: "memory_type",
        name: "Memory type",
        group: "chip",
        dataType: "text",
        rules: { maxLength: 40 },
      },
      {
        key: "memory_bus",
        name: "Memory bus",
        group: "chip",
        dataType: "integer",
        unit: "bit",
        direction: higher,
        rules: { min: 32, max: 8192 },
      },
      {
        key: "base_clock",
        name: "Base clock",
        group: "chip",
        dataType: "integer",
        unit: "MHz",
        direction: higher,
        rules: { min: 100, max: 5000 },
      },
      {
        key: "boost_clock",
        name: "Boost clock",
        group: "chip",
        dataType: "integer",
        unit: "MHz",
        direction: higher,
        rules: { min: 100, max: 5000 },
      },
      {
        key: "board_power",
        name: "Power draw",
        group: "board",
        dataType: "integer",
        unit: "W",
        filterable: true,
        direction: lower,
        rules: { min: 10, max: 1500 },
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
        name: "Length",
        group: "board",
        dataType: "integer",
        unit: "mm",
        filterable: true,
        rules: { min: 50, max: 500 },
      },
      {
        key: "height",
        name: "Height",
        group: "board",
        dataType: "integer",
        unit: "mm",
        rules: { min: 20, max: 300 },
      },
      {
        key: "power_connectors",
        name: "Power connectors",
        group: "board",
        dataType: "text",
        rules: { maxLength: 80 },
      },
    ],
  },
  {
    slug: "monitors",
    name: "Monitors",
    description: "Desktop displays.",
    icon: "monitor",
    sortOrder: 50,
    groups: [
      { key: "panel", name: "Panel", order: 10 },
      { key: "image", name: "Image", order: 20 },
      { key: "connectivity", name: "Connectivity", order: 30 },
    ],
    definitions: [
      {
        key: "screen_size",
        name: "Screen size",
        group: "panel",
        dataType: "decimal",
        unit: "in",
        required: true,
        filterable: true,
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
        dataType: "text",
        required: true,
        rules: { maxLength: 40 },
      },
      {
        key: "refresh_rate",
        name: "Refresh rate",
        group: "image",
        dataType: "integer",
        unit: "Hz",
        required: true,
        filterable: true,
        direction: higher,
        rules: { min: 24, max: 1000 },
      },
      {
        key: "response_time",
        name: "Response time",
        group: "image",
        dataType: "decimal",
        unit: "ms",
        direction: lower,
        rules: { min: 0.01, max: 100 },
      },
      {
        key: "brightness",
        name: "Brightness",
        group: "image",
        dataType: "integer",
        unit: "nits",
        direction: higher,
        rules: { min: 50, max: 10000 },
      },
      { key: "hdr_support", name: "HDR", group: "image", dataType: "boolean", filterable: true },
      {
        key: "hdr_certification",
        name: "HDR certification",
        group: "image",
        dataType: "text",
        rules: { maxLength: 80 },
      },
      {
        key: "adaptive_sync",
        name: "Adaptive sync",
        group: "image",
        dataType: "text",
        rules: { maxLength: 120 },
      },
      {
        key: "ports",
        name: "Ports",
        group: "connectivity",
        dataType: "text",
        rules: { maxLength: 500 },
      },
    ],
  },
  {
    slug: "headphones",
    name: "Headphones",
    description: "Wired and wireless headphones and earbuds.",
    icon: "headphones",
    sortOrder: 60,
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
        required: true,
        filterable: true,
        rules: { options: ["Over-ear", "On-ear", "In-ear", "Open-ear"] },
      },
      {
        key: "connection_type",
        name: "Connection",
        group: "design",
        dataType: "enum",
        required: true,
        filterable: true,
        rules: { options: ["Wireless", "Wired", "Wireless and wired"] },
      },
      {
        key: "weight",
        name: "Weight",
        group: "design",
        dataType: "integer",
        unit: "g",
        direction: lower,
        rules: { min: 1, max: 1000 },
      },
      {
        key: "driver_size",
        name: "Driver size",
        group: "audio",
        dataType: "decimal",
        unit: "mm",
        rules: { min: 1, max: 100 },
      },
      {
        key: "noise_cancelling",
        name: "Active noise cancelling",
        group: "audio",
        dataType: "boolean",
        filterable: true,
      },
      {
        key: "bluetooth_version",
        name: "Bluetooth",
        group: "battery",
        dataType: "text",
        rules: { maxLength: 40 },
      },
      {
        key: "bluetooth_codecs",
        name: "Bluetooth codecs",
        group: "battery",
        dataType: "multi_select",
        rules: {
          options: [
            "SBC",
            "AAC",
            "aptX",
            "aptX HD",
            "aptX Adaptive",
            "aptX Lossless",
            "LDAC",
            "LC3",
            "LHDC",
          ],
        },
      },
      {
        key: "battery_life",
        name: "Battery life",
        group: "battery",
        dataType: "decimal",
        unit: "h",
        direction: higher,
        rules: { min: 1, max: 500 },
      },
    ],
  },
];

export function categoryConfig(slug: string): CategoryConfig | undefined {
  return TARGET_CATEGORIES.find((c) => c.slug === slug);
}

/** Spec keys that define variants in a category (for NormalizeContext.variantKeys). */
export function variantKeysFor(slug: string | null): { storage?: string; memory?: string } {
  const out: { storage?: string; memory?: string } = {};
  for (const d of (slug ? categoryConfig(slug)?.definitions : undefined) ?? [])
    if (d.variant) out[d.variant] = d.key;
  return out;
}

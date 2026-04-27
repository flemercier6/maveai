// Shared definitions for the folders feature: color palette + icon catalog.
//
// Colors are stored as semantic IDs (e.g. "violet") in DB. Each ID maps to a
// Tailwind-friendly background + foreground combo so the chosen color
// renders consistently in the sidebar, the dialog and any preview.

import {
  Folder,
  Bookmark,
  Briefcase,
  Heart,
  Star,
  Code,
  Coffee,
  Camera,
  Music,
  Rocket,
  Lightbulb,
  Library,
  Target,
  Home,
  Gamepad2,
  GraduationCap,
  Palette,
  Tag,
  Brain,
  Sparkles,
  Globe,
  Map,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

export type FolderColorId =
  | "slate"
  | "blue"
  | "violet"
  | "pink"
  | "rose"
  | "amber"
  | "emerald"
  | "teal";

export type FolderColor = {
  id: FolderColorId;
  label: string;
  /** Background swatch (used in chips and folder icon backdrop). */
  bg: string;
  /** Foreground (icon/text on top of bg). */
  fg: string;
  /** Subtle bg for the folder row when active/hover. */
  soft: string;
};

export const FOLDER_COLORS: FolderColor[] = [
  { id: "slate",   label: "Slate",   bg: "bg-slate-500",   fg: "text-white", soft: "bg-slate-500/10" },
  { id: "blue",    label: "Blue",    bg: "bg-blue-500",    fg: "text-white", soft: "bg-blue-500/10" },
  { id: "violet",  label: "Violet",  bg: "bg-violet-500",  fg: "text-white", soft: "bg-violet-500/10" },
  { id: "pink",    label: "Pink",    bg: "bg-pink-500",    fg: "text-white", soft: "bg-pink-500/10" },
  { id: "rose",    label: "Rose",    bg: "bg-rose-500",    fg: "text-white", soft: "bg-rose-500/10" },
  { id: "amber",   label: "Amber",   bg: "bg-amber-500",   fg: "text-white", soft: "bg-amber-500/10" },
  { id: "emerald", label: "Emerald", bg: "bg-emerald-500", fg: "text-white", soft: "bg-emerald-500/10" },
  { id: "teal",    label: "Teal",    bg: "bg-teal-500",    fg: "text-white", soft: "bg-teal-500/10" },
];

export function getColor(id: string | null | undefined): FolderColor {
  return FOLDER_COLORS.find((c) => c.id === id) ?? FOLDER_COLORS[0];
}

type IconCmp = ComponentType<SVGProps<SVGSVGElement>>;

export type FolderIconDef = {
  id: string;
  label: string;
  Icon: IconCmp;
};

export const FOLDER_ICONS: FolderIconDef[] = [
  { id: "folder",     label: "Folder",     Icon: Folder },
  { id: "bookmark",   label: "Bookmark",   Icon: Bookmark },
  { id: "briefcase",  label: "Work",       Icon: Briefcase },
  { id: "heart",      label: "Heart",      Icon: Heart },
  { id: "star",       label: "Star",       Icon: Star },
  { id: "code",       label: "Code",       Icon: Code },
  { id: "coffee",     label: "Coffee",     Icon: Coffee },
  { id: "camera",     label: "Camera",     Icon: Camera },
  { id: "music",      label: "Music",      Icon: Music },
  { id: "rocket",     label: "Rocket",     Icon: Rocket },
  { id: "lightbulb",  label: "Idea",       Icon: Lightbulb },
  { id: "library",    label: "Library",    Icon: Library },
  { id: "target",     label: "Goal",       Icon: Target },
  { id: "home",       label: "Home",       Icon: Home },
  { id: "gamepad",    label: "Games",      Icon: Gamepad2 },
  { id: "school",     label: "School",     Icon: GraduationCap },
  { id: "palette",    label: "Design",     Icon: Palette },
  { id: "tag",        label: "Tag",        Icon: Tag },
  { id: "brain",      label: "Brain",      Icon: Brain },
  { id: "sparkles",   label: "Sparkles",   Icon: Sparkles },
  { id: "globe",      label: "Globe",      Icon: Globe },
  { id: "map",        label: "Map",        Icon: Map },
];

export function getIcon(id: string | null | undefined): IconCmp {
  return (FOLDER_ICONS.find((i) => i.id === id) ?? FOLDER_ICONS[0]).Icon;
}

export type FolderRow = {
  id: string;
  user_id: string;
  name: string;
  color: FolderColorId | string;
  icon: string;
  image_url: string | null;
  instructions: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

/**
 * Shim that re-exports lucide-react names but renders Hugeicons under the hood.
 * Vite resolves `lucide-react` to this file via the alias in vite.config.ts.
 *
 * Each export is a forwardRef component that accepts the same props lucide
 * exposes (className, size, strokeWidth, color, ...) so existing call-sites
 * don't need to change.
 */
import { forwardRef, type SVGProps } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  ArrowDataTransferVerticalIcon,
  AttachmentIcon,
  BrainIcon,
  Cancel01Icon,
  CircleIcon,
  CloudUploadIcon,
  Copy01Icon,
  DragDropVerticalIcon,
  File02Icon,
  Globe02Icon,
  MapsIcon,
  Loading03Icon,
  Logout01Icon,
  MoreHorizontalIcon,
  PencilEdit01Icon,
  PinIcon,
  PlusSignIcon,
  RefreshIcon,
  Search01Icon,
  Settings02Icon,
  SidebarLeft01Icon,
  SparklesIcon,
  SquareIcon,
  Tick02Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";

export type LucideProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
};

const make = (icon: IconSvgElement, displayName: string) => {
  const Comp = forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
    <HugeiconsIcon ref={ref} icon={icon} {...(props as any)} />
  ));
  Comp.displayName = displayName;
  return Comp;
};

// Arrows / chevrons
export const ArrowLeft = make(ArrowLeft01Icon, "ArrowLeft");
export const ArrowRight = make(ArrowRight01Icon, "ArrowRight");
export const ArrowUpRight = make(ArrowUpRight01Icon, "ArrowUpRight");
export const ChevronLeft = make(ArrowLeft01Icon, "ChevronLeft");
export const ChevronRight = make(ArrowRight01Icon, "ChevronRight");
export const ChevronUp = make(ArrowUp01Icon, "ChevronUp");
export const ChevronDown = make(ArrowDown01Icon, "ChevronDown");
export const ChevronsUpDown = make(ArrowDataTransferVerticalIcon, "ChevronsUpDown");

// Marks
export const Check = make(Tick02Icon, "Check");
export const X = make(Cancel01Icon, "X");
export const Circle = make(CircleIcon, "Circle");
export const Dot = make(PinIcon, "Dot");
export const MoreHorizontal = make(MoreHorizontalIcon, "MoreHorizontal");
export const GripVertical = make(DragDropVerticalIcon, "GripVertical");

// Actions
export const Copy = make(Copy01Icon, "Copy");
export const RotateCcw = make(RefreshIcon, "RotateCcw");
export const Trash2 = make(Delete02Icon, "Trash2");
export const Pencil = make(PencilEdit01Icon, "Pencil");
export const Plus = make(PlusSignIcon, "Plus");
export const Search = make(Search01Icon, "Search");
export const Settings = make(Settings02Icon, "Settings");
export const LogOut = make(Logout01Icon, "LogOut");
export const Upload = make(CloudUploadIcon, "Upload");
export const Paperclip = make(AttachmentIcon, "Paperclip");

// Misc
export const Brain = make(BrainIcon, "Brain");
export const Globe = make(Globe02Icon, "Globe");
export const Map = make(MapsIcon, "Map");
export const Sparkles = make(SparklesIcon, "Sparkles");
export const ExternalLink = make(ArrowUpRight01Icon, "ExternalLink");
export const FileText = make(File02Icon, "FileText");
export const Loader2 = make(Loading03Icon, "Loader2");
export const Square = make(SquareIcon, "Square");
export const PanelLeft = make(SidebarLeft01Icon, "PanelLeft");

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
  Hamburger01Icon,
  Menu01Icon,
  // Folder icon set
  Folder01Icon,
  FolderAddIcon,
  Image01Icon,
  Bookmark01Icon,
  Briefcase01Icon,
  FavouriteIcon,
  StarIcon,
  CodeIcon,
  CoffeeIcon,
  Camera01Icon,
  MusicNote01Icon,
  RocketIcon,
  BulbIcon,
  LibraryIcon,
  Target01Icon,
  Home01Icon,
  GameController01Icon,
  School01Icon,
  PaintBoardIcon,
  Tag01Icon,
  IncognitoIcon,
  LockIcon,
  BubbleChatIcon,
  Analytics01Icon,
  CreditCardIcon,
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
export const ArrowUp = make(ArrowUp01Icon, "ArrowUp");
export const ArrowDown = make(ArrowDown01Icon, "ArrowDown");
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
export const Menu = make(Menu01Icon, "Menu");

// Misc
export const Brain = make(BrainIcon, "Brain");
export const Globe = make(Globe02Icon, "Globe");
export const Map = make(MapsIcon, "Map");
export const Sparkles = make(SparklesIcon, "Sparkles");
export const ExternalLink = make(ArrowUpRight01Icon, "ExternalLink");
export const FileText = make(File02Icon, "FileText");
export const Loader2 = make(Loading03Icon, "Loader2");
export const MessageSquare = make(BubbleChatIcon, "MessageSquare");
export const Square = make(SquareIcon, "Square");
export const PanelLeft = make(SidebarLeft01Icon, "PanelLeft");
export const Ghost = make(IncognitoIcon, "Ghost");
export const BarChart3 = make(Analytics01Icon, "BarChart3");
export const CreditCard = make(CreditCardIcon, "CreditCard");

// Folder icon set (used by the folders feature in the sidebar)
export const Folder = make(Folder01Icon, "Folder");
export const FolderPlus = make(FolderAddIcon, "FolderPlus");
export const Image = make(Image01Icon, "Image");
export const Bookmark = make(Bookmark01Icon, "Bookmark");
export const Briefcase = make(Briefcase01Icon, "Briefcase");
export const Heart = make(FavouriteIcon, "Heart");
export const Star = make(StarIcon, "Star");
export const Code = make(CodeIcon, "Code");
export const Coffee = make(CoffeeIcon, "Coffee");
export const Camera = make(Camera01Icon, "Camera");
export const Music = make(MusicNote01Icon, "Music");
export const Rocket = make(RocketIcon, "Rocket");
export const Lightbulb = make(BulbIcon, "Lightbulb");
export const Library = make(LibraryIcon, "Library");
export const Target = make(Target01Icon, "Target");
export const Home = make(Home01Icon, "Home");
export const Gamepad2 = make(GameController01Icon, "Gamepad2");
export const GraduationCap = make(School01Icon, "GraduationCap");
export const Palette = make(PaintBoardIcon, "Palette");
export const Tag = make(Tag01Icon, "Tag");
export const Lock = make(LockIcon, "Lock");
export const LayoutDashboard = make(Analytics01Icon, "LayoutDashboard");

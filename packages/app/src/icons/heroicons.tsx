/* oxlint-disable react/only-export-components, eslint/no-restricted-imports, react/forbid-component-props -- stands in for @tabler/icons-react (aliased in vite.config.ts): filled Heroicons under Tabler's names, Tabler for the rest; the one place that imports Heroicons and maps Tabler's color prop to style */
import type { ComponentType, SVGProps } from "react"
import {
  AdjustmentsHorizontalIcon,
  ArchiveBoxIcon,
  ArrowDownIcon,
  ArrowDownTrayIcon,
  ArrowLeftEndOnRectangleIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowPathRoundedSquareIcon,
  ArrowRightIcon,
  ArrowRightStartOnRectangleIcon,
  ArrowTopRightOnSquareIcon,
  ArrowTurnUpRightIcon,
  ArrowUpIcon,
  ArrowUpLeftIcon,
  ArrowUpRightIcon,
  ArrowUpTrayIcon,
  ArrowUturnLeftIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  ArrowsRightLeftIcon,
  AtSymbolIcon,
  Bars3BottomLeftIcon,
  BeakerIcon,
  BoltIcon,
  BookOpenIcon,
  BookmarkIcon,
  BookmarkSlashIcon,
  BuildingOffice2Icon,
  BuildingStorefrontIcon,
  CalendarDateRangeIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ChartBarIcon,
  ChartBarSquareIcon,
  ChatBubbleLeftEllipsisIcon,
  ChatBubbleLeftIcon,
  ChatBubbleOvalLeftIcon,
  CheckBadgeIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpDownIcon,
  ChevronUpIcon,
  CircleStackIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  CodeBracketIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  ComputerDesktopIcon,
  CpuChipIcon,
  CreditCardIcon,
  CubeIcon,
  CursorArrowRaysIcon,
  DocumentDuplicateIcon,
  DocumentIcon,
  DocumentMagnifyingGlassIcon,
  DocumentTextIcon,
  EllipsisHorizontalIcon,
  EnvelopeIcon,
  EnvelopeOpenIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
  FaceSmileIcon,
  FolderIcon,
  FunnelIcon,
  GlobeAltIcon,
  HandRaisedIcon,
  HashtagIcon,
  InformationCircleIcon,
  KeyIcon,
  LanguageIcon,
  LifebuoyIcon,
  LightBulbIcon,
  LinkIcon,
  LinkSlashIcon,
  ListBulletIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  MapIcon,
  MicrophoneIcon,
  MinusIcon,
  MusicalNoteIcon,
  NewspaperIcon,
  NoSymbolIcon,
  PaperClipIcon,
  PauseIcon,
  PencilIcon,
  PencilSquareIcon,
  PhotoIcon,
  PlayIcon,
  PlusCircleIcon,
  PlusIcon,
  PowerIcon,
  PresentationChartLineIcon,
  PuzzlePieceIcon,
  QuestionMarkCircleIcon,
  QueueListIcon,
  RectangleStackIcon,
  ServerIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
  SignalIcon,
  SparklesIcon,
  Squares2X2Icon,
  StopIcon,
  SunIcon,
  SwatchIcon,
  TableCellsIcon,
  TagIcon,
  TicketIcon,
  TrashIcon,
  UserCircleIcon,
  UserIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
  VideoCameraIcon,
  ViewColumnsIcon,
  WindowIcon,
  WrenchIcon,
  WrenchScrewdriverIcon,
  XCircleIcon,
  ChatBubbleLeftRightIcon,
} from "@heroicons/react/20/solid"

export * from "@tabler/icons-react/dist/esm/tabler-icons-react.mjs"

type Props = SVGProps<SVGSVGElement> & {
  size?: number | string
  stroke?: number | string
  color?: string
  title?: string
  "data-weight"?: "heavy"
}

const wrap = (Hero: ComponentType<SVGProps<SVGSVGElement>>, weight = 0) => {
  function HeroIcon({ size, stroke, color, className, ...rest }: Props) {
    const extra = (rest["data-weight"] === "heavy" ? weight : 0) + Math.max(0, Number(stroke ?? 2) - 2) * 1.2
    return (
      <Hero
        width={size ?? 20}
        height={size ?? 20}
        className={["tabler-icon", className].filter(Boolean).join(" ")}
        style={color ? { color } : undefined}
        {...(extra > 0 && { stroke: "currentColor", strokeWidth: extra, strokeLinejoin: "round" as const })}
        {...rest}
      />
    )
  }
  return HeroIcon
}

export const IconActivity = wrap(ChartBarSquareIcon)
export const IconAdjustmentsHorizontal = wrap(AdjustmentsHorizontalIcon)
export const IconAlertCircle = wrap(ExclamationCircleIcon)
export const IconAlertOctagon = wrap(ExclamationCircleIcon)
export const IconAlertTriangle = wrap(ExclamationTriangleIcon)
export const IconAntennaBars5 = wrap(SignalIcon)
export const IconApps = wrap(PuzzlePieceIcon)
export const IconArchive = wrap(ArchiveBoxIcon)
export const IconArrowBackUp = wrap(ArrowUturnLeftIcon)
export const IconArrowDown = wrap(ArrowDownIcon)
export const IconArrowLeft = wrap(ArrowLeftIcon)
export const IconArrowRight = wrap(ArrowRightIcon)
export const IconArrowsDiagonal = wrap(ArrowsPointingOutIcon)
export const IconArrowsDiagonalMinimize2 = wrap(ArrowsPointingInIcon)
export const IconArrowsExchange = wrap(ArrowsRightLeftIcon)
export const IconArrowsMinimize = wrap(ArrowsPointingInIcon)
export const IconArrowUp = wrap(ArrowUpIcon)
export const IconArrowUpLeft = wrap(ArrowUpLeftIcon)
export const IconArrowUpRight = wrap(ArrowUpRightIcon)
export const IconAt = wrap(AtSymbolIcon)
export const IconAtom = wrap(BeakerIcon)
export const IconBan = wrap(NoSymbolIcon)
export const IconBook = wrap(BookOpenIcon)
export const IconBrain = wrap(LightBulbIcon)
export const IconBrowser = wrap(WindowIcon)
export const IconBuilding = wrap(BuildingOffice2Icon)
export const IconBuildingFactory2 = wrap(WrenchScrewdriverIcon)
export const IconCalendar = wrap(CalendarIcon)
export const IconCalendarDue = wrap(CalendarDaysIcon)
export const IconCalendarEvent = wrap(CalendarDateRangeIcon)
export const IconCalendarMonth = wrap(CalendarDaysIcon)
export const IconCalendarWeek = wrap(CalendarDaysIcon)
export const IconChartBar = wrap(ChartBarIcon)
export const IconChartLine = wrap(PresentationChartLineIcon)
export const IconCheck = wrap(CheckIcon)
export const IconChecklist = wrap(ClipboardDocumentCheckIcon)
export const IconChevronDown = wrap(ChevronDownIcon)
export const IconChevronLeft = wrap(ChevronLeftIcon)
export const IconChevronRight = wrap(ChevronRightIcon)
export const IconChevronUp = wrap(ChevronUpIcon)
export const IconCircleCheck = wrap(CheckCircleIcon)
export const IconCirclePlus = wrap(PlusCircleIcon)
export const IconCircleX = wrap(XCircleIcon)
export const IconClipboardText = wrap(ClipboardDocumentListIcon)
export const IconClock = wrap(ClockIcon)
export const IconCode = wrap(CodeBracketIcon)
export const IconCopy = wrap(DocumentDuplicateIcon)
export const IconCornerUpRight = wrap(ArrowTurnUpRightIcon)
export const IconCpu = wrap(CpuChipIcon)
export const IconCreditCard = wrap(CreditCardIcon)
export const IconCube = wrap(CubeIcon)
export const IconDatabase = wrap(CircleStackIcon)
export const IconDeviceDesktop = wrap(ComputerDesktopIcon)
export const IconDots = wrap(EllipsisHorizontalIcon)
export const IconDownload = wrap(ArrowDownTrayIcon)
export const IconEdit = wrap(PencilSquareIcon)
export const IconExternalLink = wrap(ArrowTopRightOnSquareIcon)
export const IconEye = wrap(EyeIcon)
export const IconEyeOff = wrap(EyeSlashIcon)
export const IconFile = wrap(DocumentIcon)
export const IconFileCode = wrap(DocumentTextIcon)
export const IconFileDiff = wrap(DocumentTextIcon)
export const IconFilePencil = wrap(DocumentTextIcon)
export const IconFiles = wrap(DocumentDuplicateIcon)
export const IconFileSearch = wrap(DocumentMagnifyingGlassIcon)
export const IconFileSpreadsheet = wrap(TableCellsIcon)
export const IconFileText = wrap(DocumentTextIcon)
export const IconFileTypePdf = wrap(DocumentIcon)
export const IconFileZip = wrap(ArchiveBoxIcon)
export const IconFilter2 = wrap(FunnelIcon)
export const IconFolder = wrap(FolderIcon)
export const IconGhost = wrap(FaceSmileIcon)
export const IconHandFinger = wrap(CursorArrowRaysIcon)
export const IconHandStop = wrap(HandRaisedIcon)
export const IconHash = wrap(HashtagIcon)
export const IconHelpCircle = wrap(QuestionMarkCircleIcon)
export const IconHistory = wrap(ClockIcon)
export const IconInfoCircle = wrap(InformationCircleIcon)
export const IconKey = wrap(KeyIcon)
export const IconLanguage = wrap(LanguageIcon)
export const IconLayoutDashboard = wrap(Squares2X2Icon)
export const IconLayoutGrid = wrap(BuildingStorefrontIcon)
export const IconLayoutGridFilled = wrap(Squares2X2Icon)
export const IconLayoutKanban = wrap(ViewColumnsIcon)
export const IconLifebuoy = wrap(LifebuoyIcon)
export const IconLink = wrap(LinkIcon)
export const IconLinkOff = wrap(LinkSlashIcon)
export const IconList = wrap(ListBulletIcon)
export const IconListCheck = wrap(ListBulletIcon)
export const IconListSearch = wrap(MagnifyingGlassIcon)
export const IconLock = wrap(LockClosedIcon)
export const IconLogin2 = wrap(ArrowLeftEndOnRectangleIcon)
export const IconLogout = wrap(ArrowRightStartOnRectangleIcon)
export const IconMail = wrap(EnvelopeIcon)
export const IconMailExclamation = wrap(EnvelopeIcon)
export const IconMailForward = wrap(EnvelopeOpenIcon)
export const IconMap = wrap(MapIcon)
export const IconMaximize = wrap(ArrowsPointingOutIcon)
export const IconMessage = wrap(ChatBubbleLeftIcon)
export const IconMessageChatbot = wrap(ChatBubbleLeftEllipsisIcon)
export const IconMessageCircle = wrap(ChatBubbleOvalLeftIcon)
export const IconMicrophone = wrap(MicrophoneIcon)
export const IconMinimize = wrap(ArrowsPointingInIcon)
export const IconMinus = wrap(MinusIcon)
export const IconMusic = wrap(MusicalNoteIcon)
export const IconNews = wrap(NewspaperIcon)
export const IconPalette = wrap(SwatchIcon)
export const IconPaperclip = wrap(PaperClipIcon)
export const IconPencil = wrap(PencilIcon)
export const IconPhoto = wrap(PhotoIcon)
export const IconPhotoUp = wrap(PhotoIcon)
export const IconPin = wrap(BookmarkIcon)
export const IconPinnedOff = wrap(BookmarkSlashIcon)
export const IconPlayerPause = wrap(PauseIcon)
export const IconPlayerPlay = wrap(PlayIcon)
export const IconPlayerStopFilled = wrap(StopIcon)
export const IconPlug = wrap(PowerIcon)
export const IconPlugOff = wrap(PowerIcon)
export const IconPlus = wrap(PlusIcon, 1.5)
export const IconProgress = wrap(ArrowPathIcon)
export const IconRefresh = wrap(ArrowPathIcon)
export const IconRepeat = wrap(ArrowPathRoundedSquareIcon)
export const IconRestore = wrap(ArrowUturnLeftIcon)
export const IconRosetteDiscountCheck = wrap(CheckBadgeIcon)
export const IconRosetteDiscountCheckFilled = wrap(CheckBadgeIcon)
export const IconRoute = wrap(MapIcon)
export const IconSearch = wrap(MagnifyingGlassIcon, 0.9)
export const IconSelector = wrap(ChevronUpDownIcon)
export const IconServer = wrap(ServerIcon)
export const IconSettings = wrap(Cog6ToothIcon)
export const IconShield = wrap(ShieldCheckIcon)
export const IconShieldLock = wrap(ShieldCheckIcon)
export const IconShieldQuestion = wrap(ShieldExclamationIcon)
export const IconSparkles = wrap(SparklesIcon)
export const IconStack2 = wrap(RectangleStackIcon)
export const IconSubtask = wrap(QueueListIcon)
export const IconSun = wrap(SunIcon)
export const IconTag = wrap(TagIcon)
export const IconTerminal2 = wrap(CommandLineIcon)
export const IconTestPipe = wrap(BeakerIcon)
export const IconTicket = wrap(TicketIcon)
export const IconTimeline = wrap(Bars3BottomLeftIcon)
export const IconTool = wrap(WrenchIcon)
export const IconTrash = wrap(TrashIcon)
export const IconUpload = wrap(ArrowUpTrayIcon)
export const IconUser = wrap(UserIcon)
export const IconUserCircle = wrap(UserCircleIcon)
export const IconUserMinus = wrap(UserMinusIcon)
export const IconUserPlus = wrap(UserPlusIcon)
export const IconUsers = wrap(UsersIcon)
export const IconUserShield = wrap(ShieldCheckIcon)
export const IconVideo = wrap(VideoCameraIcon)
export const IconWebhook = wrap(BoltIcon)
export const IconWifiOff = wrap(SignalIcon)
export const IconWorld = wrap(GlobeAltIcon)
export const IconWorldSearch = wrap(GlobeAltIcon)
export const IconWorldWww = wrap(GlobeAltIcon)
export const IconLayoutSidebar = wrap(ViewColumnsIcon)
export const IconLayoutSidebarRight = wrap(ViewColumnsIcon)
export const IconLayoutSidebarRightCollapse = wrap(ViewColumnsIcon)
export const IconMessages = wrap(ChatBubbleLeftRightIcon)

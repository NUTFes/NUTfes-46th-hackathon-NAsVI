import type * as React from 'react';

/** 時刻: Date、ISO 8601 の文字列、またはミリ秒 */
export type Time = Date | string | number;
/** スタンプの種類 */
export type StampKind = 'congestion-1' | 'congestion-2' | 'congestion-3' | 'congestion-4' | 'congestion-5' | 'fun' | 'food' | 'good';
/** アイコンの名前(Icon.names に一覧) */
export type IconName =
  | 'search' | 'search-off' | 'close' | 'locate' | 'locate-off' | 'zoom-in' | 'zoom-out' | 'plus' | 'layers' | 'stamp'
  | 'list' | 'map' | 'camera' | 'filter' | 'star' | 'bookmark' | 'tag' | 'check' | 'chevron-right' | 'navigation'
  | 'flag' | 'info' | 'wc' | 'rest' | 'trash' | 'fun' | 'food' | 'good' | 'alert';
/** 地図の上に置くとき: その点が印の中心になる(親は position: relative) */
export interface MapPosition { x?: number | string; y?: number | string }
export interface Action { label: string; onPress?: () => void; variant?: ButtonProps['variant']; icon?: IconName; disabled?: boolean }
export interface PlaceTags { wantToGo: boolean; favorite: boolean }

/* ---------- 基本の部品 ---------- */
export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** primary(主な操作。1 画面に 1 つ)/ secondary(枠だけ)/ destination(行き先にだけ使う黄)/ danger(削除) */
  variant?: 'primary' | 'secondary' | 'destination' | 'danger';
  /** 押すと起きることを動詞で(「ここへ向かう」) */
  label: React.ReactNode;
  icon?: IconName;
  /** md = 高さ 44 / lg = 48 / sm = 36(運営の表の中だけ) */
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  onPress?: () => void;
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  icon: IconName;
  /** 読み上げ用の名前(「閉じる」)。押せないときは理由も足す(「縮小(これ以上は縮小できません)」) */
  label: string;
  disabled?: boolean;
  onPress?: () => void;
  /** 面と枠を消す(色の付いた面の上で使う) */
  plain?: boolean;
  size?: number;
}
export declare function IconButton(props: IconButtonProps): React.ReactElement;

export interface ChipProps {
  label: string;
  /** 絞り込みに使っているか(Labeling.filtering) */
  selected: boolean;
  /** kind = 運営の種類 / tag = 自分用のタグ */
  source: 'kind' | 'tag';
  onToggle?: () => void;
}
export declare function Chip(props: ChipProps): React.ReactElement;

export interface TabBarProps { current: 'list' | 'map' | 'camera'; onChange?: (tab: 'list' | 'map' | 'camera') => void }
export declare function TabBar(props: TabBarProps): React.ReactElement;

export interface SearchFieldProps {
  value: string;
  /** 既定「企画・場所を検索」 */
  placeholder?: string;
  onChange?: (value: string) => void;
  onClear?: () => void;
  /** 拡張の「文章で探す」を出すか(OQ-8) */
  naturalSearch?: boolean;
}
export declare function SearchField(props: SearchFieldProps): React.ReactElement;

export interface FilterBandProps {
  /** 選んでいる種類・タグ */
  labels: string[];
  /** 絞った後の件数。検索中は渡さない */
  count?: number;
  /** 0 件のときの理由と次の手 */
  emptyHint?: string;
  onClear?: () => void;
}
export declare function FilterBand(props: FilterBandProps): React.ReactElement;

export interface BannerProps {
  /** warning = 使えない(読み上げは status)/ error = 失敗(読み上げは alert) */
  tone: 'warning' | 'error';
  title: string;
  body?: string;
  /** 2 つまで。先頭は削除の色、2 つ目は枠だけ */
  actions?: Action[];
  /** 【Design System で追加】見出しの左のアイコン。既定は warning = info、error = alert */
  icon?: IconName;
}
export declare function Banner(props: BannerProps): React.ReactElement;

export interface ToastProps {
  /** 「混雑3 を足元に押しました」。札などの部品も渡せる */
  message: React.ReactNode;
  /** 既定「取り消す」 */
  undoLabel?: string;
  onUndo?: () => void;
  /** 既定 6000。消す時間は使う側が管理する */
  durationMs?: number;
}
export declare function Toast(props: ToastProps): React.ReactElement;

export interface BadgeProps { label: string; tone?: 'neutral' | 'parking' | 'ok' | 'warn' }
export declare function Badge(props: BadgeProps): React.ReactElement;

export interface CheckRowProps {
  label: string;
  /** 「最初からあるタグ」「4 件」 */
  sublabel?: string;
  /** アイコンの名前か、部品 */
  icon?: IconName | React.ReactNode;
  checked: boolean;
  onToggle?: () => void;
}
export declare function CheckRow(props: CheckRowProps): React.ReactElement;

export interface EmptyStateProps {
  title: string;
  body?: string;
  /** 先頭が主な操作(絞り込み中は「絞り込みを解除して探す」を先頭に。D-012) */
  actions?: Action[];
  /** 【Design System で追加】既定 search-off */
  icon?: IconName;
}
export declare function EmptyState(props: EmptyStateProps): React.ReactElement;

/** 【Design System で追加】ワイヤーフレームのアイコン。線の色は CSS の color を引き継ぐ */
export interface IconProps {
  name: IconName;
  size?: number;
  /** star・bookmark・navigation を塗りつぶす */
  filled?: boolean;
  strokeWidth?: number;
  /** 回転(度) */
  rotate?: number;
  /** 渡すと role="img" で読み上げる。渡さなければ飾り */
  label?: string;
  color?: string;
}
export declare function Icon(props: IconProps): React.ReactElement;

/* ---------- 地図の印 ---------- */
export interface BuildingFlagProps extends MapPosition {
  buildingId: string;
  /** 企画数(絞り込み中は絞った後の数) */
  count: number;
  /** 【Design System で追加】読み上げ用の建物名 */
  name?: string;
  selected?: boolean;
  isDestination?: boolean;
  onPress?: () => void;
}
export declare function BuildingFlag(props: BuildingFlagProps): React.ReactElement;

export interface EventMarkProps extends MapPosition { placeId: string; name: string; zoomed: boolean }
export declare function EventMark(props: EventMarkProps): React.ReactElement;

export interface FacilityMarkProps extends MapPosition { kind: 'info' | 'wc' | 'rest' | 'trash'; zoomed?: boolean }
export declare function FacilityMark(props: FacilityMarkProps): React.ReactElement;

export interface ParkingMarkProps extends MapPosition { placeId: string }
export declare function ParkingMark(props: ParkingMarkProps): React.ReactElement;

export interface StampMarkProps extends MapPosition {
  kind: StampKind;
  pressedAt: Time;
  zoomed?: boolean;
  /** まとめたほかの件数。1 以上なら「+N」 */
  more?: number;
}
export declare function StampMark(props: StampMarkProps): React.ReactElement;

export interface PositionMarkProps extends MapPosition {
  headingDeg?: number;
  accuracyM?: number;
  /** 古いとき灰色にする(原則 P2) */
  stale?: boolean;
}
export declare function PositionMark(props: PositionMarkProps): React.ReactElement;

export interface DestinationMarkProps extends MapPosition {
  placeId: string;
  showLine?: boolean;
  /** 【Design System で追加】読み上げ用の名前 */
  name?: string;
  /** 【Design System で追加】現在地までの線の長さ(px)と向き(度。0 = 右) */
  lineLength?: number;
  lineAngleDeg?: number;
}
export declare function DestinationMark(props: DestinationMarkProps): React.ReactElement;

/* ---------- 画面の部品 ---------- */
export interface PlaceRowProps {
  /** 会期中に変わらないこと(#17) */
  placeId: string;
  /** 2 行まで */
  name: string;
  kindLabel?: string;
  building?: string;
  floor?: string;
  /** 現在地が無ければ渡さない */
  distanceM?: number;
  /** 検索語。名前の中で強調 */
  highlight?: string;
  /** 渡すと右にしおりと星を出す */
  tags?: PlaceTags;
  onOpen?: () => void;
  onToggleTag?: (tag: keyof PlaceTags, on: boolean) => void;
  /** 【Design System で追加】行き先の場所は左に黄の印 */
  isDestination?: boolean;
  /** 【Design System で追加】読み込み中の灰色の帯 */
  loading?: boolean;
}
export declare function PlaceRow(props: PlaceRowProps): React.ReactElement;

export interface PlaceCardProps {
  placeId: string;
  name: string;
  kind: 'event' | 'parking' | 'facility';
  building?: string;
  floor?: string;
  description?: string;
  /** 「両日 10:00〜16:00」 */
  hours?: string;
  distanceM?: number;
  tags: PlaceTags;
  onGo?: () => void;
  onToggleTag?: (tag: keyof PlaceTags, on: boolean) => void;
  onOpenTags?: () => void;
  onClose?: () => void;
  /** 【Design System で追加】読み込み中 */
  loading?: boolean;
  /** 【Design System で追加】運営が削除した場所 */
  removed?: boolean;
}
export declare function PlaceCard(props: PlaceCardProps): React.ReactElement;

export interface DestinationCardProps {
  state: 'guiding' | 'arrived';
  /** 2 行まで */
  placeName: string;
  building?: string;
  floor?: string;
  /** 端末の向きからの角度 */
  headingDeg?: number;
  /** 直線距離 */
  remainingM?: number;
  /** 30 秒以上前なら「更新が止まっています」と目立たせる */
  updatedAt?: Time;
  accuracyM?: number;
  onCamera?: () => void;
  /** Destination.clear ※ */
  onStop?: () => void;
  onFinish?: () => void;
  onBuildingMap?: () => void;
  /** 【Design System で追加】方角の言葉(「北」)、着いたときの補足、着いたとみなす距離 */
  directionLabel?: string;
  note?: string;
  arriveWithinM?: number;
}
export declare function DestinationCard(props: DestinationCardProps): React.ReactElement;

export interface DestinationBarProps {
  /** 1 行。入りきらないときは末尾を「…」 */
  placeName: string;
  remainingM: number;
  onStop?: () => void;
  /** 【Design System で追加】矢印の向き */
  headingDeg?: number;
}
export declare function DestinationBar(props: DestinationBarProps): React.ReactElement;

export interface SheetProps { title: string; subtitle?: string; onClose?: () => void; children: React.ReactNode }
export declare function Sheet(props: SheetProps): React.ReactElement;

export interface StampCongestionPickerProps { disabled?: boolean; onPick?: (level: 1 | 2 | 3 | 4 | 5) => void }
export declare function StampCongestionPicker(props: StampCongestionPickerProps): React.ReactElement;

export interface StampFeelingButtonProps { feeling: 'fun' | 'food' | 'good'; disabled?: boolean; onPress?: () => void }
export declare function StampFeelingButton(props: StampFeelingButtonProps): React.ReactElement;

export interface MyStampRowProps {
  stampId: string;
  kind: StampKind;
  pressedAt: Time;
  /** 混雑だけ。期限は OQ-4 */
  expiresAt?: Time;
  onRetract?: () => void;
  /** 【Design System で追加】取り消し中 */
  retracting?: boolean;
}
export declare function MyStampRow(props: MyStampRowProps): React.ReactElement;

export interface TagCreateFieldProps {
  value: string;
  onCreate?: (name: string) => void;
  /** 空欄・重複など(OQ-13) */
  error?: string;
  /** 【Design System で追加】入力が変わったとき */
  onChange?: (value: string) => void;
}
export declare function TagCreateField(props: TagCreateFieldProps): React.ReactElement;

export interface FloorTab { id: string; label: string; count?: number }
export interface BuildingFloorTabsProps { floors: FloorTab[]; current: string; onChange?: (id: string) => void }
export declare function BuildingFloorTabs(props: BuildingFloorTabsProps): React.ReactElement;

export interface FloorPlace { id: string; name?: string; kind?: 'event' | 'info' | 'wc' | 'rest' | 'trash'; x: number | string; y: number | string }
export interface BuildingFloorPlanProps {
  /** 見取り図の形(SVG の viewBox と path) */
  plan: { viewBox: string; d: string };
  places: FloorPlace[];
  /** 【Design System で追加】読み上げ用の名前、右上の注記、企画を押したとき */
  label?: string;
  note?: string;
  onOpen?: (placeId: string) => void;
}
export declare function BuildingFloorPlan(props: BuildingFloorPlanProps): React.ReactElement;

export interface CameraLabel { name: string; distanceM: number; x: number | string; y: number | string; behind?: boolean; isDestination?: boolean }
export interface BuildingCameraOverlayProps {
  /** 現在地・向き・建物の形から端末で決める */
  frontBuilding?: string;
  labels: CameraLabel[];
  /** 無いとき(null)は「向きが分からない」(V3-c) */
  heading: number | null;
  accuracyM?: number;
  /** カメラの映像(下に敷く) */
  children?: React.ReactNode;
  /** 【Design System で追加】大きさと「正面」の札の高さ */
  width?: number; height?: number; frontY?: number | string;
}
export declare function BuildingCameraOverlay(props: BuildingCameraOverlayProps): React.ReactElement;

/* ---------- 運営(PC) ---------- */
export interface DataColumn<R> { key: string; label: string; render?: (row: R) => React.ReactNode }
export interface DataTableProps<R extends { id: string }> {
  rows: R[];
  selectedId?: string;
  onEdit?: (id: string) => void;
  /** 【Design System で追加】列の定義と、0 件のときの文 */
  columns: DataColumn<R>[];
  emptyText?: string;
}
export declare function DataTable<R extends { id: string }>(props: DataTableProps<R>): React.ReactElement;

export interface FormFieldProps {
  label: string;
  kind?: 'text' | 'textarea' | 'select';
  value: string;
  error?: string;
  /** 【Design System で追加】 */
  onChange?: (value: string) => void;
  options?: string[];
  help?: string;
}
export declare function FormField(props: FormFieldProps): React.ReactElement;

export interface LocationPickerProps {
  /** 地図の中の位置(横・縦の %) */
  value?: { x: number; y: number };
  onChange?: (value: { x: number; y: number }) => void;
  /** 【Design System で追加】下に描く建物の形(viewBox 0 0 100 60 の path)と見出し */
  buildings?: string[];
  label?: string;
}
export declare function LocationPicker(props: LocationPickerProps): React.ReactElement;

export interface BuildingShapePreviewProps {
  /** 無いとき「形なし(カメラの正面に出ない)」 */
  shape?: { viewBox: string; d: string } | null;
  onReload?: () => void;
}
export declare function BuildingShapePreview(props: BuildingShapePreviewProps): React.ReactElement;

export interface DeleteConfirmProps {
  title: string;
  /** 「検索・一覧から消え、案内も終わる」 */
  effects: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}
export declare function DeleteConfirm(props: DeleteConfirmProps): React.ReactElement;

declare global {
  interface Window {
    NAsVI: {
      Button: typeof Button; IconButton: typeof IconButton; Chip: typeof Chip; TabBar: typeof TabBar; SearchField: typeof SearchField;
      FilterBand: typeof FilterBand; Banner: typeof Banner; Toast: typeof Toast; Badge: typeof Badge; CheckRow: typeof CheckRow;
      EmptyState: typeof EmptyState; Icon: typeof Icon & { names: IconName[] };
      BuildingFlag: typeof BuildingFlag; EventMark: typeof EventMark; FacilityMark: typeof FacilityMark; ParkingMark: typeof ParkingMark;
      StampMark: typeof StampMark; PositionMark: typeof PositionMark; DestinationMark: typeof DestinationMark;
      PlaceRow: typeof PlaceRow; PlaceCard: typeof PlaceCard; DestinationCard: typeof DestinationCard; DestinationBar: typeof DestinationBar;
      Sheet: typeof Sheet; StampCongestionPicker: typeof StampCongestionPicker; StampFeelingButton: typeof StampFeelingButton;
      MyStampRow: typeof MyStampRow; TagCreateField: typeof TagCreateField; BuildingFloorTabs: typeof BuildingFloorTabs;
      BuildingFloorPlan: typeof BuildingFloorPlan; BuildingCameraOverlay: typeof BuildingCameraOverlay;
      DataTable: typeof DataTable; FormField: typeof FormField; LocationPicker: typeof LocationPicker;
      BuildingShapePreview: typeof BuildingShapePreview; DeleteConfirm: typeof DeleteConfirm;
    };
  }
}

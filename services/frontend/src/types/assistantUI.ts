/**
 * Chat Assistant UI Component Types
 * Structured UI components for rich message rendering
 */

// Base UI Component
export interface UIComponent {
  type: 'card' | 'table' | 'button' | 'chart' | 'copy_field' | 'quick_actions';
  data: CardData | TableData | ButtonData | ChartData | CopyFieldData | QuickActionsData;
}

// Card Component - for metrics and entity details
export interface CardData {
  title: string;
  subtitle?: string;
  metrics?: CardMetric[];
  actions?: CardAction[];
  variant?: 'default' | 'success' | 'warning' | 'error';
}

export interface CardMetric {
  label: string;
  value: string;
  delta?: string;        // e.g., "+15%"
  trend?: 'up' | 'down' | 'neutral';
  icon?: string;         // lucide icon name
}

export interface CardAction {
  label: string;
  action: string;        // e.g., "pauseCampaign"
  params: Record<string, unknown>;
  variant?: 'primary' | 'secondary' | 'danger';
  needsConfirmation?: boolean;
}

// Table Component - for lists and comparisons
export interface TableData {
  headers: string[];
  rows: TableRow[];
  sortable?: boolean;
  compact?: boolean;
}

export interface TableRow {
  cells: (string | number | TableCell)[];
  entityId?: string;     // For entity linking
  entityType?: string;
}

export interface TableCell {
  value: string | number;
  variant?: 'success' | 'warning' | 'error' | 'muted';
  icon?: string;
}

// Copy Field Component - for IDs, phones, links
export interface CopyFieldData {
  label: string;
  value: string;
  icon?: 'phone' | 'id' | 'link' | 'key';
}

// Button Component - standalone action button
export interface ButtonData {
  label: string;
  action: string;
  params: Record<string, unknown>;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
  needsConfirmation?: boolean;
  confirmationMessage?: string;
}

// Quick Actions Component - group of action buttons
export interface QuickActionsData {
  title?: string;
  actions: QuickAction[];
}

export interface QuickAction {
  label: string;
  action: string;
  params: Record<string, unknown>;
  icon?: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

// Chart Component - for visualizations
export interface ChartData {
  type: 'bar' | 'line' | 'pie' | 'sparkline';
  data: ChartDataPoint[];
  labels?: string[];
  options?: ChartOptions;
}

export interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface ChartOptions {
  showLegend?: boolean;
  showGrid?: boolean;
  height?: number;
}

// Extended message type with UI components
export interface AssistantMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  plan_json?: PlanStep[] | null;
  actions_json?: ExecutedAction[] | null;
  ui_json?: UIComponent[] | null;
  created_at: string;
}

export interface PlanStep {
  action: string;
  description: string;
  params: Record<string, unknown>;
  status?: 'pending' | 'executing' | 'completed' | 'failed';
}

export interface ExecutedAction {
  tool: string;
  args: Record<string, unknown>;
  result: 'success' | 'failed';
  message?: string;
}

// Helper type guards
export function isCardData(data: unknown): data is CardData {
  return typeof data === 'object' && data !== null && 'title' in data;
}

export function isTableData(data: unknown): data is TableData {
  return typeof data === 'object' && data !== null && 'headers' in data && 'rows' in data;
}

export function isCopyFieldData(data: unknown): data is CopyFieldData {
  return typeof data === 'object' && data !== null && 'value' in data && 'label' in data;
}

export function isButtonData(data: unknown): data is ButtonData {
  return typeof data === 'object' && data !== null && 'action' in data && 'label' in data && !('actions' in data);
}

export function isQuickActionsData(data: unknown): data is QuickActionsData {
  return typeof data === 'object' && data !== null && 'actions' in data && Array.isArray((data as QuickActionsData).actions);
}

export function isChartData(data: unknown): data is ChartData {
  return typeof data === 'object' && data !== null && 'type' in data && 'data' in data;
}

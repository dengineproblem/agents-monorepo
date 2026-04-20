# Multi-Direction Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-direction select with multi-select checkboxes dropdown so a creative can be uploaded/created to multiple directions at once.

**Architecture:** Create a shared `DirectionMultiSelect` component using existing Popover + Checkbox primitives, then replace the `<Select>` in three places (VideoUpload, CreativeGeneration, CarouselTab). State changes from `string` to `string[]`. On save/upload, call the API once per selected direction. VideoUpload uses the first direction for the webhook upload, then calls `assign-direction` for each additional direction after success.

**Tech Stack:** React, TypeScript, shadcn/ui (Popover, Checkbox), existing `creativesApi.assignToDirection`

---

## Task 1: Create DirectionMultiSelect component

**Files:**
- Create: `services/frontend/src/components/ui/direction-multi-select.tsx`

- [ ] **Step 1: Create the component file**

```tsx
// services/frontend/src/components/ui/direction-multi-select.tsx
import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Direction {
  id: string;
  name: string;
  [key: string]: any;
}

interface DirectionMultiSelectProps {
  directions: Direction[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  renderLabel?: (direction: Direction) => string;
  className?: string;
}

export function DirectionMultiSelect({
  directions,
  selectedIds,
  onChange,
  disabled = false,
  placeholder = 'Выберите направления',
  renderLabel,
  className,
}: DirectionMultiSelectProps) {
  const getLabel = (d: Direction) => renderLabel ? renderLabel(d) : d.name;

  const triggerText = (() => {
    if (selectedIds.length === 0) return placeholder;
    const first = directions.find(d => d.id === selectedIds[0]);
    if (!first) return placeholder;
    if (selectedIds.length === 1) return getLabel(first);
    return `${getLabel(first)}, +${selectedIds.length - 1}`;
  })();

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(x => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal',
            selectedIds.length === 0 && 'text-muted-foreground',
            className
          )}
        >
          <span className="truncate">{triggerText}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full min-w-[240px] p-1" align="start">
        {directions.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">Направления не найдены</p>
        ) : (
          directions.map((direction) => (
            <div
              key={direction.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-accent"
              onClick={() => toggle(direction.id)}
            >
              <Checkbox
                checked={selectedIds.includes(direction.id)}
                onCheckedChange={() => toggle(direction.id)}
                onClick={(e) => e.stopPropagation()}
              />
              <span className="text-sm truncate">{getLabel(direction)}</span>
            </div>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/anatolijstepanov/agents-monorepo/services/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors for the new file.

- [ ] **Step 3: Commit**

```bash
cd /Users/anatolijstepanov/agents-monorepo
git add services/frontend/src/components/ui/direction-multi-select.tsx
git commit -m "feat: add DirectionMultiSelect component with checkbox dropdown"
```

---

## Task 2: Update useAutoSaveDraft.ts interfaces

**Files:**
- Modify: `services/frontend/src/hooks/useAutoSaveDraft.ts:22,56`

- [ ] **Step 1: Change `selectedDirectionId: string` → `selectedDirectionIds: string[]` in ImageDraft**

In `useAutoSaveDraft.ts`, line 22:
```typescript
// Before:
selectedDirectionId: string;

// After:
selectedDirectionIds: string[];
```

- [ ] **Step 2: Change same field in CarouselDraft**

Line 56:
```typescript
// Before:
selectedDirectionId: string;

// After:
selectedDirectionIds: string[];
```

- [ ] **Step 3: Handle backward-compat when reading old drafts**

In `useImageDraftAutoSave`, find the draft restore section (where `draft.selectedDirectionId` is checked) and update:

Old code (around line 207 in CreativeGeneration.tsx, but driven by the hook's saved value):
The hook just stores/returns the draft. The restore logic is in the components. We need to make sure old drafts (which have `selectedDirectionId: string`) still work.

In `useAutoSaveDraft.ts`, the `saveDraft` function just calls `localStorage.setItem`. The loaded draft is cast as `ImageDraft | CarouselDraft`. Add a migration helper at the load point.

Find the place in the hook where the stored value is parsed:
```typescript
const draft = JSON.parse(stored) as ImageDraft;
```

After this line, add:
```typescript
// Migrate old draft format (selectedDirectionId: string → selectedDirectionIds: string[])
if ('selectedDirectionId' in (draft as any) && !draft.selectedDirectionIds) {
  draft.selectedDirectionIds = (draft as any).selectedDirectionId
    ? [(draft as any).selectedDirectionId]
    : [];
}
```

Do the same for CarouselDraft.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/anatolijstepanov/agents-monorepo/services/frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
cd /Users/anatolijstepanov/agents-monorepo
git add services/frontend/src/hooks/useAutoSaveDraft.ts
git commit -m "feat: update draft interfaces to support multiple direction IDs"
```

---

## Task 3: Update CarouselTab.tsx

**Files:**
- Modify: `services/frontend/src/components/creatives/CarouselTab.tsx`

- [ ] **Step 1: Add import for DirectionMultiSelect**

At top of file after existing imports:
```typescript
import { DirectionMultiSelect } from '@/components/ui/direction-multi-select';
```

- [ ] **Step 2: Change state from string to array**

Line 56:
```typescript
// Before:
const [selectedDirectionId, setSelectedDirectionId] = useState('');

// After:
const [selectedDirectionIds, setSelectedDirectionIds] = useState<string[]>([]);
```

- [ ] **Step 3: Update draft save/restore**

Line ~129 (in the auto-save useEffect deps/body), wherever `selectedDirectionId` is referenced in the draft save:
```typescript
// Before:
selectedDirectionId
// After:
selectedDirectionIds
```

Line ~159 (draft restore):
```typescript
// Before:
if (draft.selectedDirectionId) {
  setSelectedDirectionId(draft.selectedDirectionId);
}

// After:
if (draft.selectedDirectionIds?.length) {
  setSelectedDirectionIds(draft.selectedDirectionIds);
}
```

- [ ] **Step 4: Update direction_id in generate calls (lines 420, 511)**

```typescript
// Before:
direction_id: selectedDirectionId || undefined

// After:
direction_id: selectedDirectionIds[0] || undefined
```

- [ ] **Step 5: Update handleCreateCreative to call API for each direction**

Replace the current `handleCreateCreative` function (line ~826):

```typescript
const handleCreateCreative = async () => {
  if (!userId || !generatedCarouselId || selectedDirectionIds.length === 0) {
    toast.error('Выберите направление для создания креатива');
    return;
  }

  setIsCreatingCreative(true);
  const toastId = toast.loading(
    selectedDirectionIds.length > 1
      ? `Загружаем карусель в ${selectedDirectionIds.length} направления...`
      : 'Загружаем карусель в Facebook...'
  );

  const results = await Promise.allSettled(
    selectedDirectionIds.map(directionId =>
      carouselApi.createCreative({
        user_id: userId,
        account_id: currentAdAccountId || undefined,
        carousel_id: generatedCarouselId,
        direction_id: directionId,
      })
    )
  );

  const succeeded = results.filter(
    r => r.status === 'fulfilled' && r.value.success
  ).length;
  const failed = results.length - succeeded;

  if (succeeded === results.length) {
    const directionNames = selectedDirectionIds
      .map(id => directions.find(d => d.id === id)?.name || id)
      .join(', ');
    toast.success(
      succeeded === 1
        ? `Креатив создан! Направление: ${directionNames}`
        : `Креатив создан в ${succeeded} направлениях: ${directionNames}`,
      { id: toastId }
    );
    clearCarouselDraft();
  } else if (succeeded > 0) {
    toast.warning(`Создан в ${succeeded} из ${results.length} направлениях. Ошибка в ${failed}.`, { id: toastId });
  } else {
    const firstError = results.find(r => r.status === 'fulfilled') as any;
    const errorMsg = firstError?.value?.error || 'Ошибка создания креатива';
    toast.error(errorMsg, { id: toastId });
  }

  setIsCreatingCreative(false);
};
```

- [ ] **Step 6: Update handleReset (line ~871)**

```typescript
// Before:
setSelectedDirectionId('');
// After:
setSelectedDirectionIds([]);
```

- [ ] **Step 7: Replace Select with DirectionMultiSelect in JSX (line ~1658)**

```tsx
// Before:
<div className="space-y-2">
  <Label className="text-xs text-muted-foreground">Направление</Label>
  <Select value={selectedDirectionId} onValueChange={setSelectedDirectionId} disabled={!directions.length}>
    <SelectTrigger className="w-full">
      <SelectValue placeholder="Выберите направление" />
    </SelectTrigger>
    <SelectContent>
      {directions.map(d => (
        <SelectItem key={d.id} value={d.id}>
          {d.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>

// After:
<div className="space-y-2">
  <Label className="text-xs text-muted-foreground">Направление</Label>
  <DirectionMultiSelect
    directions={directions}
    selectedIds={selectedDirectionIds}
    onChange={setSelectedDirectionIds}
    disabled={!directions.length}
    placeholder="Выберите направления"
  />
</div>
```

- [ ] **Step 8: Update disabled condition on the Create button (line ~1676)**

```tsx
// Before:
disabled={!selectedDirectionId || isCreatingCreative}
// After:
disabled={selectedDirectionIds.length === 0 || isCreatingCreative}
```

- [ ] **Step 9: Remove unused Select imports if no longer used elsewhere in CarouselTab**

Check if `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` are still used elsewhere in CarouselTab.tsx. Remove from imports if not.

- [ ] **Step 10: Verify TypeScript compiles**

```bash
cd /Users/anatolijstepanov/agents-monorepo/services/frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 11: Commit**

```bash
cd /Users/anatolijstepanov/agents-monorepo
git add services/frontend/src/components/creatives/CarouselTab.tsx
git commit -m "feat: multi-direction select for carousel creative creation"
```

---

## Task 4: Update CreativeGeneration.tsx

**Files:**
- Modify: `services/frontend/src/pages/CreativeGeneration.tsx`

- [ ] **Step 1: Add import for DirectionMultiSelect**

```typescript
import { DirectionMultiSelect } from '@/components/ui/direction-multi-select';
```

- [ ] **Step 2: Change state from string to array**

Line 89:
```typescript
// Before:
const [selectedDirectionId, setSelectedDirectionId] = useState<string>('');
// After:
const [selectedDirectionIds, setSelectedDirectionIds] = useState<string[]>([]);
```

- [ ] **Step 3: Update draft save/restore**

In the useEffect that saves draft (~line 173), replace `selectedDirectionId` with `selectedDirectionIds`.

In the restore block (~line 207):
```typescript
// Before:
if (draft.selectedDirectionId) {
  setSelectedDirectionId(draft.selectedDirectionId);
}

// After:
if (draft.selectedDirectionIds?.length) {
  setSelectedDirectionIds(draft.selectedDirectionIds);
}
```

- [ ] **Step 4: Update save-draft calls (~line 665, 742)**

```typescript
// Before:
direction_id: selectedDirectionId || undefined

// After:
direction_id: selectedDirectionIds[0] || undefined
```

- [ ] **Step 5: Update reset (~line 322)**

```typescript
// Before:
setSelectedDirectionId('');
// After:
setSelectedDirectionIds([]);
```

- [ ] **Step 6: Update createCreative validation (~line 926) and add multi-direction loop**

Replace the entire `createCreative` function:

```typescript
const createCreative = async () => {
  if (!generatedImage || selectedDirectionIds.length === 0 || !generatedCreativeId) {
    toast.error('Выберите направление');
    return;
  }

  setIsCreatingCreative(true);

  try {
    toast.loading('Подготовка 4K версии (9:16)...', { id: 'upscale-create' });

    // 1. Upscale once (shared across all directions)
    const upscaleResponse = await fetch(`${CREATIVE_API_BASE}/upscale-to-4k`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creative_id: generatedCreativeId, user_id: userId }),
    });

    const upscaleData = await upscaleResponse.json();
    if (!upscaleData.success || !upscaleData.image_url_4k) {
      throw new Error('Не удалось создать 4K версию изображения');
    }

    toast.loading(
      selectedDirectionIds.length > 1
        ? `Создание в ${selectedDirectionIds.length} направлениях...`
        : 'Создание креатива в Facebook...',
      { id: 'upscale-create' }
    );

    // 2. Create creative for each direction
    const results = await Promise.allSettled(
      selectedDirectionIds.map(directionId =>
        fetch(`${API_BASE_URL}/create-image-creative`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            account_id: currentAdAccountId || undefined,
            creative_id: generatedCreativeId,
            direction_id: directionId,
          }),
        }).then(r => r.json())
      )
    );

    const succeeded = results.filter(
      r => r.status === 'fulfilled' && (r.value as any).success
    ).length;
    const failed = results.length - succeeded;

    if (succeeded === results.length) {
      const directionNames = selectedDirectionIds
        .map(id => directions.find(d => d.id === id)?.name || id)
        .join(', ');
      toast.success(
        succeeded === 1
          ? `Креатив создан! Направление: ${directionNames}`
          : `Креатив создан в ${succeeded} направлениях: ${directionNames}`,
        { id: 'upscale-create' }
      );

      setGeneratedImage(null);
      setGeneratedCreativeId('');
      setTexts({ offer: '', bullets: '', profits: '' });
      setSelectedDirectionIds([]);
      clearImageDraft();
    } else if (succeeded > 0) {
      toast.warning(
        `Создан в ${succeeded} из ${results.length} направлениях. Ошибка в ${failed}.`,
        { id: 'upscale-create' }
      );
    } else {
      const firstFulfilled = results.find(r => r.status === 'fulfilled') as any;
      throw new Error(firstFulfilled?.value?.error || 'Ошибка создания креатива в Facebook');
    }
  } catch (error: any) {
    console.error('Ошибка при создании креатива:', error);
    toast.error(error.message || 'Ошибка создания креатива', { id: 'upscale-create' });
  } finally {
    setIsCreatingCreative(false);
  }
};
```

- [ ] **Step 7: Replace Select with DirectionMultiSelect in JSX (~line 1548)**

```tsx
// Before:
{directions.length > 0 ? (
  <Select
    value={selectedDirectionId}
    onValueChange={setSelectedDirectionId}
    disabled={directionsLoading || isCreatingCreative}
  >
    <SelectTrigger className="w-full">
      <SelectValue placeholder="Выберите направление" />
    </SelectTrigger>
    <SelectContent>
      {directions.map((direction) => (
        <SelectItem key={direction.id} value={direction.id}>
          {direction.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
) : (
  <p className="text-sm text-muted-foreground">
    Направления не найдены. Создайте направление в профиле.
  </p>
)}

// After:
{directions.length > 0 ? (
  <DirectionMultiSelect
    directions={directions}
    selectedIds={selectedDirectionIds}
    onChange={setSelectedDirectionIds}
    disabled={directionsLoading || isCreatingCreative}
    placeholder="Выберите направления"
  />
) : (
  <p className="text-sm text-muted-foreground">
    Направления не найдены. Создайте направление в профиле.
  </p>
)}
```

- [ ] **Step 8: Update disabled on Create button (~line 1573)**

```tsx
// Before:
disabled={!selectedDirectionId || isCreatingCreative || directionsLoading}
// After:
disabled={selectedDirectionIds.length === 0 || isCreatingCreative || directionsLoading}
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
cd /Users/anatolijstepanov/agents-monorepo/services/frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 10: Commit**

```bash
cd /Users/anatolijstepanov/agents-monorepo
git add services/frontend/src/pages/CreativeGeneration.tsx
git commit -m "feat: multi-direction select for image creative creation"
```

---

## Task 5: Update VideoUpload.tsx

**Files:**
- Modify: `services/frontend/src/components/VideoUpload.tsx`

- [ ] **Step 1: Add import for DirectionMultiSelect and creativesApi**

At top of file add:
```typescript
import { DirectionMultiSelect } from '@/components/ui/direction-multi-select';
import { creativesApi } from '@/services/creativesApi';
```

(Check if `creativesApi` is already imported — if not, add it.)

- [ ] **Step 2: Change state and add ref for extra directions**

Line 165:
```typescript
// Before:
const [selectedDirectionId, setSelectedDirectionId] = useState<string>('');

// After:
const [selectedDirectionIds, setSelectedDirectionIds] = useState<string[]>([]);
const extraDirectionIdsRef = useRef<string[]>([]);
```

(`useRef` is already imported at line 1.)

- [ ] **Step 3: Update reset-on-account-change (~line 180)**

```typescript
// Before:
setSelectedDirectionId('');
// After:
setSelectedDirectionIds([]);
```

- [ ] **Step 4: Update auto-select useEffect (~line 188)**

```typescript
// Before:
useEffect(() => {
  if (!directionsLoading && directions.length > 0 && !selectedDirectionId) {
    const filtered = directions.filter(d => d.objective === campaignGoal);
    const toSelect = filtered.length > 0 ? filtered[0].id : directions[0].id;
    setSelectedDirectionId(toSelect);
  }
}, [directions, directionsLoading, selectedDirectionId, campaignGoal]);

// After:
useEffect(() => {
  if (!directionsLoading && directions.length > 0 && selectedDirectionIds.length === 0) {
    const filtered = directions.filter(d => d.objective === campaignGoal);
    const toSelect = filtered.length > 0 ? filtered[0].id : directions[0].id;
    setSelectedDirectionIds([toSelect]);
  }
}, [directions, directionsLoading, selectedDirectionIds.length, campaignGoal]);
```

- [ ] **Step 5: Update form direction_id for video upload (~line 802) and image upload (~line 1345)**

```typescript
// Before:
if (selectedDirectionId) form.append('direction_id', selectedDirectionId);
// After (both occurrences):
if (selectedDirectionIds[0]) form.append('direction_id', selectedDirectionIds[0]);
```

- [ ] **Step 6: Store extra directions before upload**

Just before `performUpload(form, webhookUrl, 0, 'video')` (~line 1000) and just before `performUpload(form, webhookUrl, 0, 'image')` (~line 1409), add:
```typescript
extraDirectionIdsRef.current = selectedDirectionIds.slice(1);
```

- [ ] **Step 7: Assign extra directions after upload success**

In `performUpload`'s `xhr.onload` success handler, inside both `setTimeout(() => { ... }, 2000)` blocks (lines ~470-500 and ~514-544), after `refreshData()` add:

```typescript
// Assign to additional directions if any were selected
const extraIds = extraDirectionIdsRef.current;
if (extraIds.length > 0) {
  extraDirectionIdsRef.current = [];
  // Fetch the most recent creative for this user to get its ID
  const storedUser = localStorage.getItem('user');
  const localUserData = storedUser ? JSON.parse(storedUser) : {};
  const userId = localUserData?.id;
  if (userId) {
    try {
      const res = await fetch(`${API_BASE_URL}/user-creatives?user_account_id=${userId}${currentAdAccountId ? `&account_id=${currentAdAccountId}` : ''}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const creatives = await res.json();
        // Most recent creative is the one we just uploaded
        if (creatives?.length > 0) {
          const newest = [...creatives].sort((a: any, b: any) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )[0];
          const assignResults = await Promise.allSettled(
            extraIds.map(dirId =>
              creativesApi.assignToDirection(newest.id, dirId, currentAdAccountId)
            )
          );
          const ok = assignResults.filter(r => r.status === 'fulfilled' && (r.value as any).success).length;
          if (ok > 0) {
            toast.success(`Креатив также привязан к ${ok} дополнительным направлениям`);
          }
        }
      }
    } catch (e) {
      console.error('Ошибка привязки к дополнительным направлениям:', e);
    }
  }
}
```

Note: The `xhr.onload` callback is synchronous but the inner `setTimeout` callback is async. Change the `setTimeout` arrow function to `async`: `setTimeout(async () => { ... }, 2000)`.

- [ ] **Step 8: Update disabled condition on the "Запустить" button (~line 1561)**

```tsx
// Before:
disabled={isUploading || ((placement === 'instagram' || placement === 'both') && !selectedDirectionId)}
// After:
disabled={isUploading || ((placement === 'instagram' || placement === 'both') && selectedDirectionIds.length === 0)}
```

- [ ] **Step 9: Replace Select with DirectionMultiSelect in JSX (~line 1771)**

```tsx
// Before:
<div className="mb-4">
  <label className="block mb-1 font-medium">{t('video.businessDirection')}</label>
  <Select
    value={selectedDirectionId}
    onValueChange={setSelectedDirectionId}
    disabled={isUploading || directionsLoading}
  >
    <SelectTrigger className="w-full">
      <SelectValue placeholder={t('video.selectDirection')} className="truncate" />
    </SelectTrigger>
    <SelectContent className="max-w-[calc(100vw-4rem)]">
      {directions
        .filter(d => !campaignGoal || d.objective === campaignGoal)
        .map((direction) => (
          <SelectItem key={direction.id} value={direction.id}>
            <span className="block truncate max-w-[350px]" title={`${direction.name} (${getDirectionObjectiveLabel(direction)})`}>
              {direction.name} ({getDirectionObjectiveLabel(direction)})
            </span>
          </SelectItem>
        ))}
    </SelectContent>
  </Select>
  <p className="text-xs text-muted-foreground mt-1">
    Креатив будет связан с выбранным направлением
  </p>
</div>

// After:
<div className="mb-4">
  <label className="block mb-1 font-medium">{t('video.businessDirection')}</label>
  <DirectionMultiSelect
    directions={directions.filter(d => !campaignGoal || d.objective === campaignGoal)}
    selectedIds={selectedDirectionIds}
    onChange={setSelectedDirectionIds}
    disabled={isUploading || directionsLoading}
    placeholder={t('video.selectDirection')}
    renderLabel={(d) => `${d.name} (${getDirectionObjectiveLabel(d)})`}
  />
  <p className="text-xs text-muted-foreground mt-1">
    Креатив будет связан с выбранными направлениями
  </p>
</div>
```

- [ ] **Step 10: Verify TypeScript compiles**

```bash
cd /Users/anatolijstepanov/agents-monorepo/services/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 11: Commit**

```bash
cd /Users/anatolijstepanov/agents-monorepo
git add services/frontend/src/components/VideoUpload.tsx
git commit -m "feat: multi-direction select for video/image upload"
```

---

## Task 6: Manual Testing Checklist

- [ ] **Test 1: DirectionMultiSelect UI**
  - Open any page with the direction selector
  - Verify dropdown opens with checkboxes
  - Select 1 direction → trigger shows its name
  - Select 2+ directions → trigger shows "Name1, +N"
  - Deselect all → trigger shows placeholder
  - Disabled state → button is non-interactive

- [ ] **Test 2: CarouselTab**
  - Generate a carousel
  - In step 4, select 2 directions
  - Click "Создать креатив"
  - Verify toast shows "Создан в 2 направлениях"
  - Check in creatives gallery that 2 records exist for that carousel

- [ ] **Test 3: CreativeGeneration (image)**
  - Generate an image
  - Select 2+ directions
  - Click "Создать креатив"
  - Verify toast shows all direction names
  - Check gallery for multiple records

- [ ] **Test 4: VideoUpload**
  - Select a video file
  - Select 2 directions from the multi-select
  - Upload
  - After success, verify "Креатив также привязан к 1 дополнительным направлениям" toast appears
  - Check creatives gallery for 2 records

- [ ] **Test 5: Backward compat draft**
  - If a draft exists in localStorage with `selectedDirectionId: "abc"`, restoring it should set `selectedDirectionIds: ["abc"]`

- [ ] **Test 6: Single direction still works**
  - Select just 1 direction and upload/create — behavior unchanged

---

## Final Commit

```bash
cd /Users/anatolijstepanov/agents-monorepo
git log --oneline -5
```

All tasks complete. Multi-direction upload feature is live.

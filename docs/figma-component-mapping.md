# Figma → shadcn/ui Component Mapping

> **Figma File:** LaWallet v2.2 Master (`jcjT53BBQ4wx94XwpbEZXl`)
> **Figma Page:** Components (node `3030:135`)
> **Theme:** Dark mode (neutral base)

---

## Design Tokens

### Colors (Dark Theme CSS Variables)

| CSS Variable | Value | Tailwind Class |
|---|---|---|
| `--background` | `#0a0a0a` | `bg-background` |
| `--foreground` | `#f5f5f5` | `text-foreground` |
| `--card` | `#171717` | `bg-card` |
| `--card-foreground` | `#f5f5f5` | `text-card-foreground` |
| `--popover` | `#262626` | `bg-popover` |
| `--popover-foreground` | `#fafafa` | `text-popover-foreground` |
| `--primary` | `#f5f5f5` | `bg-primary` |
| `--primary-foreground` | `#0a0a0a` | `text-primary-foreground` |
| `--secondary` | `#262626` | `bg-secondary` |
| `--secondary-foreground` | `#f5f5f5` | `text-secondary-foreground` |
| `--muted` | `#262626` | `bg-muted` |
| `--muted-foreground` | `#a3a3a3` | `text-muted-foreground` |
| `--accent` | `#171717` | `bg-accent` |
| `--accent-foreground` | `#f5f5f5` | `text-accent-foreground` |
| `--destructive` | `#991b1b` | `bg-destructive` |
| `--destructive-foreground` | `#fee2e2` | `text-destructive-foreground` |
| `--border` | `#262626` | `border-border` |
| `--ring` | `#737373` | `ring-ring` |
| `--sidebar` | `#171717` | `bg-sidebar` |

### Status/Accent Colors

| Token | Value | Tailwind |
|---|---|---|
| `red/500` | `#ef4444` | `text-red-500` |
| `green/500` | `#22c55e` | `text-green-500` |
| `blue/500` | `#3b82f6` | `text-blue-500` |
| `yellow/500` | `#eab308` | `text-yellow-500` |

### Neutral Scale (Primary Button Gradient)

| Token | Value |
|---|---|
| `neutral/300` | `#404040` |
| `neutral/600` | `#a3a3a3` |
| `neutral/800` | `#e5e5e5` |
| `neutral/900` | `#f5f5f5` |

### Typography

| Style | Font | Size | Weight | Line Height |
|---|---|---|---|---|
| `text-xs` | Inter | 12px | 400 | 16px |
| `text-sm` | Inter | 14px | 400 | 20px |
| `text-sm/semibold` | Inter | 14px | 600 | 20px |
| `text-base` | Inter | 16px | 400 | 24px |
| `text-lg/semibold` | Inter | 18px | 600 | 28px |
| `text-4xl/semibold` | Inter | 36px | 600 | 40px |

### Border Radius

| Token | Value | Tailwind |
|---|---|---|
| `radius-sm` | 6px | `rounded-sm` |
| `radius-md` | 8px | `rounded-md` |
| `radius-lg` | 10px | `rounded-lg` |
| `radius-xl` | 12px | `rounded-xl` |
| `radius-3xl` | 24px | `rounded-3xl` |
| `radius-full` | 9999px | `rounded-full` |

### Shadows

| Token | Value | Tailwind |
|---|---|---|
| `shadow-xs` | `0 1px 2px rgba(0,0,0,0.1)` | `shadow-xs` |
| `shadow-sm` | `0 1px 3px rgba(0,0,0,0.1)` | `shadow-sm` |
| `shadow-md` | `0 4px 6px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.1)` | `shadow-md` |

---

## Standard shadcn/ui Components (1:1 Mapping)

These Figma components map directly to existing shadcn/ui components. Already installed in `components/ui/`.

| # | Figma Component | Figma Node | shadcn Component | File | Status |
|---|---|---|---|---|---|
| 1 | Accordion | `3030:195` | `<Accordion>` | `accordion.tsx` | Installed |
| 2 | Alert Dialog | `3030:391` | `<AlertDialog>` | `alert-dialog.tsx` | Installed |
| 3 | Alert | `3030:510` | `<Alert>` | `alert.tsx` | Installed |
| 4 | Aspect Ratio | `3030:530` | `<AspectRatio>` | `aspect-ratio.tsx` | Installed |
| 5 | Avatar | `3030:584` | `<Avatar>` | `avatar.tsx` | Installed |
| 6 | Badge | `3030:644` | `<Badge>` | `badge.tsx` | Installed |
| 7 | Breadcrumb | `3030:713` | `<Breadcrumb>` | `breadcrumb.tsx` | Installed |
| 8 | Button | `3030:869` | `<Button>` | `button.tsx` | Installed |
| 9 | Calendar | `3030:1690` | `<Calendar>` | `calendar.tsx` | Installed |
| 10 | Card | `3030:2225` | `<Card>` | `card.tsx` | Installed |
| 11 | Carousel | `3030:2297` | `<Carousel>` | `carousel.tsx` | Installed |
| 12 | Chart | `3030:2367` | `<Chart>` | `chart.tsx` | Installed |
| 13 | Checkbox | `3030:2558` | `<Checkbox>` | `checkbox.tsx` | Installed |
| 14 | Collapsible | `3030:2623` | `<Collapsible>` | `collapsible.tsx` | Installed |
| 15 | Command | `3030:2770` | `<Command>` | `command.tsx` | Installed |
| 16 | Context Menu | `3030:2833` | `<ContextMenu>` | `context-menu.tsx` | Installed |
| 17 | Dialog | `3030:3297` | `<Dialog>` | `dialog.tsx` | Installed |
| 18 | Drawer | `3030:3392` | `<Drawer>` | `drawer.tsx` | Installed |
| 19 | Dropdown Menu | `3030:3481` | `<DropdownMenu>` | `dropdown-menu.tsx` | Installed |
| 20 | Hover Card | `3030:3788` | `<HoverCard>` | `hover-card.tsx` | Installed |
| 21 | Input | `3030:4139` | `<Input>` | `input.tsx` | Installed |
| 22 | Input OTP | `3030:3996` | `<InputOTP>` | `input-otp.tsx` | Installed |
| 23 | Label | `3030:4430` | `<Label>` | `label.tsx` | Installed |
| 24 | Menubar | `3030:4485` | `<Menubar>` | `menubar.tsx` | Installed |
| 25 | Navigation Menu | `3030:4624` | `<NavigationMenu>` | `navigation-menu.tsx` | Installed |
| 26 | Pagination | `3030:4690` | `<Pagination>` | `pagination.tsx` | Installed |
| 27 | Popover | `3030:4784` | `<Popover>` | `popover.tsx` | Installed |
| 28 | Progress | `3030:4873` | `<Progress>` | `progress.tsx` | Installed |
| 29 | Radio Group | `3030:4927` | `<RadioGroup>` | `radio-group.tsx` | Installed |
| 30 | Scroll Area | `3030:4981` | `<ScrollArea>` | `scroll-area.tsx` | Installed |
| 31 | Select | `3030:5074` | `<Select>` | `select.tsx` | Installed |
| 32 | Separator | `3030:5141` | `<Separator>` | `separator.tsx` | Installed |
| 33 | Sheet | `3030:5201` | `<Sheet>` | `sheet.tsx` | Installed |
| 34 | Sidebar | `3030:5293` | `<Sidebar>` | `sidebar.tsx` | Installed |
| 35 | Skeleton | `3030:5368` | `<Skeleton>` | `skeleton.tsx` | Installed |
| 36 | Slider | `3030:5475` | `<Slider>` | `slider.tsx` | Installed |
| 37 | Sonner | `3030:5535` | `<Sonner>` | `sonner.tsx` | Installed |
| 38 | Switch | `3030:5724` | `<Switch>` | `switch.tsx` | Installed |
| 39 | Table | `3030:5777` | `<Table>` | `table.tsx` | Installed |
| 40 | Tabs | `3030:5832` | `<Tabs>` | `tabs.tsx` | Installed |
| 41 | Toggle | `3030:6177` | `<Toggle>` | `toggle.tsx` | Installed |
| 42 | Toggle Group | `3030:6065` | `<ToggleGroup>` | `toggle-group.tsx` | Installed |
| 43 | Tooltip | `3030:6260` | `<Tooltip>` | `tooltip.tsx` | Installed |

---

### Additional Figma-only Components (not yet in codebase)

| # | Figma Component | Figma Node | Notes |
|---|---|---|---|
| — | Empty State | `3030:3575` | Dashed border + icon + heading + description |
| — | Item | `3030:4238` | List item pattern |
| — | Logo | `3287:6626` | LaWallet logo |
| — | Sidebar (v2) | `3194:5540` | Alternate sidebar layout |

---

## Composite shadcn Components (Composition Patterns)

These Figma components are built by composing multiple shadcn primitives.

### 44. Combobox
- **Figma Node:** `3030:2689`
- **Composition:** `<Popover>` + `<Command>` (CommandInput + CommandList + CommandItem)
- **Trigger:** `<Button variant="outline" role="combobox">`
- **Variants:** Default, Popover (with label), Responsive, DropdownMenu
- **Usage:**
```tsx
<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline" role="combobox">
      {value || "Select framework..."} <ChevronsUpDown className="opacity-50" />
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-[200px] p-0">
    <Command>
      <CommandInput placeholder="Search..." />
      <CommandList>
        <CommandItem onSelect={...}>
          <Check className={cn("size-4", selected ? "opacity-100" : "opacity-0")} />
          {item.label}
        </CommandItem>
      </CommandList>
    </Command>
  </PopoverContent>
</Popover>
```

### 45. Data Table
- **Figma Node:** `3030:2899`
- **Composition:** `<Card>` + `<Input>` (search) + `<DropdownMenu>` (columns) + `<Table>` + `<Checkbox>` (row select) + `<Button variant="outline">` (pagination)
- **Library:** TanStack Table (`@tanstack/react-table`)
- **Features:** Column filtering, row selection, sorting (arrow-up-down icon), pagination, row actions (ellipsis menu)
- **Styling:** Card wrapper `rounded-3xl p-14`, table `rounded-md border`, rows 49px height, header 40px
- **Usage:**
```tsx
<Card className="rounded-3xl p-14">
  <div className="flex items-center gap-2">
    <Input placeholder="Filter emails..." className="max-w-sm" />
    <DropdownMenu>{/* column toggles */}</DropdownMenu>
  </div>
  <Table>
    <TableHeader>{/* columns with Checkbox, sortable headers */}</TableHeader>
    <TableBody>{/* rows with Checkbox, data cells, action menu */}</TableBody>
  </Table>
  <div className="flex items-center justify-between">
    <span className="text-sm text-muted-foreground">0 of 5 row(s) selected</span>
    <div className="flex gap-2">
      <Button variant="outline" size="sm">Previous</Button>
      <Button variant="outline" size="sm">Next</Button>
    </div>
  </div>
</Card>
```

### 46. Date Picker
- **Figma Node:** `3030:2979`
- **Composition:** `<Popover>` + `<Calendar>` + `<Input>` (time) + `<Command>` (natural language)
- **Variants:**
  - **NaturalLanguagePicker:** Trigger button + popover with text options ("Tomorrow", "In 3 days", etc.)
  - **DateAndTimePicker:** Trigger + calendar grid + time input below
  - **PickerWithInput:** Separate Month/Day/Year inputs + calendar popover
- **Usage:**
```tsx
<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline">
      <CalendarIcon className="size-4" /> {format(date, "PPP")}
    </Button>
  </PopoverTrigger>
  <PopoverContent>
    <Calendar mode="single" selected={date} onSelect={setDate} />
    <Input type="time" value={time} onChange={...} />
  </PopoverContent>
</Popover>
```

### 47. Responsive Dialog
- **Figma Node:** `594:375`
- **Composition:** `<Dialog>` (desktop) / `<Drawer>` (mobile)
- **Structure:** Overlay (`bg-black/30`) + content card (`bg-background border rounded-lg p-6`) + title + description + form fields + primary action button
- **Primary Button:** Gradient `from-neutral-400 to-neutral-100`, border `neutral-700`, inner shadow `inset 0 2px 2px rgba(255,255,255,0.4)`
- **Usage:**
```tsx
// Desktop: Dialog, Mobile: Drawer
const isDesktop = useMediaQuery("(min-width: 768px)")

if (isDesktop) {
  return (
    <Dialog>
      <DialogTrigger asChild><Button variant="outline">Edit Profile</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>Make changes to your profile...</DialogDescription>
        </DialogHeader>
        {/* form fields */}
        <Button className="bg-gradient-to-b from-neutral-400 to-neutral-100 text-primary-foreground">
          Save changes
        </Button>
      </DialogContent>
    </Dialog>
  )
}
return <Drawer>{/* same content in DrawerContent */}</Drawer>
```

---

## Custom Components (New — Not in shadcn)

These require new component files in `components/ui/`.

### 48. Topbar
- **Figma Node:** `3194:5154`
- **File:** `components/ui/topbar.tsx`
- **Variants:** `device: "desktop" | "mobile"`, `type: "page" | "subpage" | "page-alert" | "subpage-alert"`
- **Structure:**
  - Title (16px semibold) + subtitle (14px muted)
  - Action buttons: Cancel (`variant="secondary"`) + Save Changes (primary gradient)
  - Alert bar (conditional): destructive banner with title, message, action button
  - Tab bar (subpage): horizontal tabs on `bg-accent` background
- **Styling:** `border-b border-border`, h-[60px], `px-4 py-2`
- **Usage:**
```tsx
<Topbar
  title="Page Title"
  subtitle="Description"
  type="page"
  alert={{ title: "Alert", message: "Something happened", action: "Fix" }}
  actions={<><Button variant="secondary">Cancel</Button><Button variant="primary">Save</Button></>}
  tabs={[{ label: "Tab 1", active: true }, { label: "Tab 2" }]}
/>
```

### 49. Topbar Mobile
- **Figma Node:** `3057:11598`
- **File:** `components/ui/topbar-mobile.tsx`
- **Variants:** `type: "page" | "subpage"`
- **Structure:**
  - Page: Avatar (36px) + centered logo + right icon slot
  - Subpage: Back button (`variant="secondary" size="sm"` + ChevronLeft) + centered title + right action slot
- **Styling:** `bg-sidebar`, h-[60px], `px-4 py-2`
- **Usage:**
```tsx
<TopbarMobile type="subpage" title="Settings" onBack={() => router.back()} />
```

### 50. Button Group
- **Figma Node:** `3030:895`
- **File:** `components/ui/button-group.tsx`
- **Description:** Groups multiple buttons with shared border, overflow-clip, and dividers
- **Sub-patterns:** Toolbar, vertical orientation, segmented buttons (sizes S/M/L), pagination, split button, input group, dropdown split, select split, popover split
- **Styling:** `flex overflow-hidden rounded-md border border-border`, children separated by `border-r`
- **Usage:**
```tsx
<ButtonGroup>
  <Button variant="outline" size="icon"><ArrowLeft /></Button>
  <Button variant="outline">Archive</Button>
  <Button variant="outline">Report</Button>
</ButtonGroup>

<ButtonGroup orientation="vertical">
  <Button variant="outline" size="icon"><Plus /></Button>
  <Button variant="outline" size="icon"><Minus /></Button>
</ButtonGroup>
```

### 51. Spinner
- **Figma Node:** `3030:5621`
- **File:** `components/ui/spinner.tsx`
- **Variants:** `size: 12 | 16 | 24 | 32`, `color: "default" | "red" | "green" | "blue" | "yellow"`
- **Sub-patterns:**
  - Inline: Spinner + text + amount on semi-transparent bg
  - Button loading: `<Button disabled><Spinner /> Loading...</Button>` at 50% opacity
  - Badge loading: `<Badge><Spinner size={12} /> Syncing</Badge>`
  - Input loading: Input at 50% opacity with spinner icon
  - Empty state: Dashed border container + spinner + heading + description + cancel button
  - Progress item: Card with spinner, title, subtitle, progress bar, cancel button
- **Usage:**
```tsx
<Spinner size={24} />
<Spinner size={16} color="green" />
<Button disabled><Spinner size={16} className="mr-2" /> Loading...</Button>
```

### 52. Swipe Button
- **Figma Node:** `3177:6875`
- **File:** `components/ui/swipe-button.tsx`
- **States:** `default` → `active` (mid-swipe) → `loading` → `done`
- **Styling:** 343px wide, 52px tall, `rounded-md border border-border`
  - Default: `bg-secondary`, thumb gradient left, "Swipe to Confirm" text
  - Active: Primary gradient bg, thumb dragged right, "Zap it" text
  - Loading: Gradient bg, Loader icon in thumb, "Pending" text
  - Done: `bg-secondary`, full-width thumb with Check icon
- **Interaction:** Touch/drag events, `translateX` thumb animation
- **Usage:**
```tsx
<SwipeButton
  label="Swipe to Confirm"
  activeLabel="Zap it"
  loadingLabel="Pending"
  onConfirm={handlePayment}
/>
```

### 53. Kbd (Keyboard Shortcut)
- **Figma Node:** `3030:4363`
- **File:** `components/ui/kbd.tsx`
- **Description:** Keyboard shortcut badges (20x20px, `bg-muted rounded-sm`)
- **Sub-patterns:**
  - Standalone keys: ⌘, ⇧, ⌥, ⌃
  - Combo: `Ctrl + B`
  - In button: `<Button>Accept <Kbd>Enter</Kbd></Button>`
  - In tooltip: Tooltip with kbd hint
  - In input: Search input with `⌘K` badge
- **Usage:**
```tsx
<Kbd>⌘</Kbd>
<Kbd>K</Kbd>
<div className="flex gap-1"><Kbd>Ctrl</Kbd><span>+</span><Kbd>B</Kbd></div>
```

### 54. Input Group
- **Figma Node:** `3030:3878`
- **File:** `components/ui/input-group.tsx`
- **Description:** Enhanced input with prefix/suffix text, icons, dropdowns, spinners
- **Sub-patterns:**
  - With icon (left): Search, Mail, CreditCard icons
  - With trailing icons: Star, Info
  - With text prefix/suffix: `$` + input + `USD`; `https://` + input + `.com`
  - With dropdown: Ellipsis trigger → popover menu
  - With spinner: Loader animation, "Searching..." text, 50% opacity
  - With label: Floating label above input
  - Chat/AI input: Large textarea + bottom toolbar (+ button, auto label, send button)
  - Autoresize textarea: Textarea + gradient submit button
  - Code editor: Header (filename + actions) + code body + footer (cursor pos + Run button)
- **Styling:** `flex items-center border border-border bg-background rounded-lg shadow-xs`
- **Usage:**
```tsx
<InputGroup>
  <InputGroupPrefix><Search className="size-4" /></InputGroupPrefix>
  <Input placeholder="Search..." />
  <InputGroupSuffix className="text-muted-foreground text-sm">12 results</InputGroupSuffix>
</InputGroup>

<InputGroup>
  <InputGroupText>https://</InputGroupText>
  <Input placeholder="example" />
  <InputGroupText>.com</InputGroupText>
</InputGroup>
```

### 55. Field
- **Figma Node:** `3030:3680`
- **File:** `components/ui/field.tsx`
- **Description:** Form field composition (label + control + description + error)
- **Sub-patterns:**
  - Input field: Label + Input + description
  - Textarea field: Label + Textarea + description
  - Select field: Label + Select + description
  - Slider field: Label + description + Slider
  - Fieldset: Heading + description + grouped fields
  - Checkbox group: Heading + multiple checkboxes with labels
  - Radio group: Heading + radio items
  - Switch: Label + description + Switch toggle
  - Choice card: Selectable cards with radio indicator
  - Responsive layout: 2-column (label left, control right)
  - Payment form: Multi-field form composition
- **Usage:**
```tsx
<Field>
  <FieldLabel>Username</FieldLabel>
  <Input placeholder="Enter username" />
  <FieldDescription>This is your public display name.</FieldDescription>
</Field>

<Fieldset>
  <FieldsetLegend>Address</FieldsetLegend>
  <FieldsetDescription>Enter your mailing address.</FieldsetDescription>
  <Field><FieldLabel>Street</FieldLabel><Input /></Field>
  <div className="grid grid-cols-2 gap-4">
    <Field><FieldLabel>City</FieldLabel><Input /></Field>
    <Field><FieldLabel>Postal Code</FieldLabel><Input /></Field>
  </div>
</Fieldset>
```

### 56. Checkbox Card
- **Figma Node:** `511:817`
- **File:** `components/ui/checkbox-card.tsx`
- **States:** Unchecked (`bg-background border-border`) / Checked (`bg-accent border-primary`)
- **Structure:** Checkbox (16px) + title + description in a bordered card
- **Styling:** `flex gap-3 items-start p-3 rounded-lg border cursor-pointer`
- **Usage:**
```tsx
<CheckboxCard
  checked={enabled}
  onCheckedChange={setEnabled}
  title="Enable notifications"
  description="You can enable or disable notifications at any time."
/>
```

### 57. Link Card
- **Figma Node:** `1201:1030`
- **File:** `components/ui/link-card.tsx`
- **Variants:** `type: "default" | "outline"`
- **Structure:** Heading + description + trailing icon (ChevronRight or ExternalLink)
- **Styling:**
  - Default: `flex items-center p-4 gap-4` (no border)
  - Outline: Same + `border border-border rounded-md`
- **Usage:**
```tsx
<LinkCard href="/docs" type="outline">
  <LinkCardTitle>External resource</LinkCardTitle>
  <LinkCardDescription>Opens in a new tab</LinkCardDescription>
</LinkCard>
```

### 58. Native Select
- **Figma Node:** `3030:4549`
- **File:** `components/ui/native-select.tsx`
- **Description:** Styled native `<select>` element (not Radix-based)
- **Variants:** Default, WithGroups (`<optgroup>`), InvalidState (`border-destructive`), Disabled
- **Styling:** `appearance-none h-9 bg-background border border-border rounded-md pl-3 pr-9 py-2 text-sm shadow-xs` + custom chevron-down icon
- **Usage:**
```tsx
<NativeSelect placeholder="Select a status">
  <option value="todo">Todo</option>
  <option value="progress">In Progress</option>
  <option value="done">Done</option>
</NativeSelect>

<NativeSelect error>
  <optgroup label="Engineering">
    <option>Frontend</option>
    <option>Backend</option>
  </optgroup>
</NativeSelect>
```

---

## Component Checklist

### Standard shadcn (43 components) — Style token update only
- [x] Accordion
- [x] Alert Dialog
- [x] Alert
- [x] Aspect Ratio
- [x] Avatar
- [x] Badge
- [x] Breadcrumb
- [x] Button
- [x] Calendar
- [x] Card
- [x] Carousel
- [x] Chart
- [x] Checkbox
- [x] Collapsible
- [x] Command
- [x] Context Menu
- [x] Dialog
- [x] Drawer
- [x] Dropdown Menu
- [x] Hover Card
- [x] Input
- [x] Input OTP
- [x] Label
- [x] Menubar
- [x] Navigation Menu
- [x] Pagination
- [x] Popover
- [x] Progress
- [x] Radio Group
- [x] Scroll Area
- [x] Select
- [x] Separator
- [x] Sheet
- [x] Sidebar
- [x] Skeleton
- [x] Slider
- [x] Sonner
- [x] Switch
- [x] Table
- [x] Tabs
- [x] Toggle
- [x] Toggle Group
- [x] Tooltip

### Composite (4 components) — Build from shadcn primitives
- [ ] Combobox (Popover + Command)
- [ ] Data Table (Table + TanStack Table)
- [ ] Date Picker (Popover + Calendar)
- [ ] Responsive Dialog (Dialog + Drawer)

### Custom (11 components) — New files needed
- [x] Topbar (`components/ui/topbar.tsx`)
- [x] Topbar Mobile (`components/ui/topbar-mobile.tsx`)
- [x] Button Group (`components/ui/button-group.tsx`)
- [x] Spinner (`components/ui/spinner.tsx`)
- [x] Swipe Button (`components/ui/swipe-button.tsx`)
- [x] Kbd (`components/ui/kbd.tsx`)
- [x] Input Group (`components/ui/input-group.tsx`)
- [x] Field (`components/ui/field.tsx`)
- [x] Checkbox Card (`components/ui/checkbox-card.tsx`)
- [x] Link Card (`components/ui/link-card.tsx`)
- [x] Native Select (`components/ui/native-select.tsx`)

---

## Figma Screens (Pages / Layouts)

Dashboard screens from the Figma file to be implemented as Next.js pages.

> **How to add a screen:** Paste the Figma frame link, extract fileKey and nodeId, and fill in a row below.
> Format: `https://figma.com/design/:fileKey/:fileName?node-id=:nodeId`

### Admin Dashboard Screens

| # | Screen | Figma Node | Route | Status |
|---|--------|-----------|-------|--------|
| 1 | Dashboard Home | — | `/admin` | Placeholder |
| 2 | Cards List | — | `/admin/cards` | Not started |
| 3 | Card Detail | — | `/admin/cards/[id]` | Not started |
| 4 | Create Card | — | `/admin/cards/new` | Not started |
| 5 | Designs Gallery | — | `/admin/designs` | Not started |
| 6 | Lightning Addresses | — | `/admin/addresses` | Not started |
| 7 | Settings | — | `/admin/settings` | Not started |
| 8 | Login | — | `/admin` (modal) | Not started |

### Wallet Screens

| # | Screen | Figma Node | Route | Status |
|---|--------|-----------|-------|--------|
| 1 | Login / Signup | — | `/wallet/login` | Not started |
| 2 | Wallet Home | — | `/wallet` | Placeholder |
| 3 | Settings | — | `/wallet/settings` | Not started |
| 4 | Setup Lightning Address | — | `/wallet/setup/lightning-address` | Not started |
| 5 | Setup NWC | — | `/wallet/setup/nwc` | Not started |
| 6 | Card Activation | — | `/wallet/activate/[otc]` | Not started |

### Landing Page Screens

| # | Screen | Figma Node | Route | Status |
|---|--------|-----------|-------|--------|
| 1 | Landing Page (Full) | — | `/` | Placeholder |

---

## Figma Subpages (Figma File Structure)

Pages within the Figma file. The "Components" page is already mapped above.

> **How to add a subpage:** Open the Figma file, note the page name, right-click the page in the sidebar → "Copy link to page", extract the node-id.

| # | Figma Page | Node ID | Description | Mapped |
|---|-----------|---------|-------------|--------|
| 1 | Components | `3030:135` | Design system components | ✅ Yes |
| 2 | — | — | *(paste link to add)* | No |
| 3 | — | — | *(paste link to add)* | No |
| 4 | — | — | *(paste link to add)* | No |

---

## How to Add New Figma References

### Adding a new component
1. Find the component frame in Figma → right-click → "Copy link"
2. Extract `nodeId` from URL: `?node-id=XXXX-YYYY` → `XXXX:YYYY`
3. Add a row to the appropriate table above
4. Add `// @figma https://www.figma.com/design/jcjT53BBQ4wx94XwpbEZXl?node-id=XXXX-YYYY` as the first line of the component source file

### Adding a new screen
1. Find the screen frame in Figma → right-click → "Copy link"
2. Extract `nodeId` from URL
3. Add a row to the "Figma Screens" section above
4. When implementing, use `get_design_context` MCP tool with the nodeId to generate code

### Adding a new Figma page
1. In Figma sidebar, right-click the page → "Copy link to page"
2. Extract `nodeId` from URL
3. Add a row to the "Figma Subpages" section above
4. Use `get_metadata` MCP tool with the nodeId to explore the page's contents

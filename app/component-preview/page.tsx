'use client'

import * as React from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Bell,
  Bold,
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CreditCard,
  ExternalLink,
  GripVertical,
  Home,
  Italic,
  Loader2,
  Mail,
  Minus,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Star,
  Terminal,
  Trash2,
  Underline,
  User
} from 'lucide-react'
import { toast } from 'sonner'

// Standard shadcn
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'

// Additional standard shadcn (previously missing from preview)
import { AspectRatio } from '@/components/ui/aspect-ratio'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext
} from '@/components/ui/carousel'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut
} from '@/components/ui/command'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger
} from '@/components/ui/drawer'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger
} from '@/components/ui/hover-card'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator
} from '@/components/ui/input-otp'
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger
} from '@/components/ui/menubar'
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle
} from '@/components/ui/navigation-menu'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious
} from '@/components/ui/pagination'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@/components/ui/resizable'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet'

// Custom components
import { Spinner } from '@/components/ui/spinner'
import { Kbd } from '@/components/ui/kbd'
import { ButtonGroup } from '@/components/ui/button-group'
import { CheckboxCard } from '@/components/ui/checkbox-card'
import { LinkCard, LinkCardTitle, LinkCardDescription } from '@/components/ui/link-card'
import { NativeSelect } from '@/components/ui/native-select'
import {
  InputGroup,
  InputGroupPrefix,
  InputGroupSuffix,
  InputGroupText
} from '@/components/ui/input-group'
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  Fieldset,
  FieldsetLegend,
  FieldsetDescription
} from '@/components/ui/field'
import { Topbar } from '@/components/ui/topbar'
import { TopbarMobile } from '@/components/ui/topbar-mobile'
import { SwipeButton } from '@/components/ui/swipe-button'

// --- Helpers ---

function Section({
  id,
  title,
  children
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="text-2xl font-semibold text-foreground mb-4 border-b border-border pb-2">
        {title}
      </h2>
      <div className="space-y-6">{children}</div>
    </section>
  )
}

function Demo({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
        {label}
      </p>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </div>
  )
}

// --- Nav items for sidebar ---
const navSections = [
  {
    group: 'Standard shadcn',
    items: [
      'accordion', 'alert', 'alert-dialog', 'aspect-ratio', 'avatar',
      'badge', 'breadcrumb', 'button', 'calendar', 'card',
      'carousel', 'checkbox', 'collapsible', 'command',
      'context-menu', 'dialog', 'drawer', 'dropdown-menu',
      'hover-card', 'input', 'input-otp', 'label', 'menubar',
      'navigation-menu', 'pagination', 'popover', 'progress',
      'radio-group', 'resizable', 'scroll-area', 'select',
      'separator', 'sheet', 'skeleton', 'slider', 'sonner',
      'switch', 'table', 'tabs', 'textarea', 'toggle',
      'toggle-group', 'tooltip'
    ]
  },
  {
    group: 'Custom Components',
    items: [
      'spinner', 'kbd', 'button-group', 'checkbox-card',
      'link-card', 'native-select', 'input-group', 'field',
      'topbar', 'topbar-mobile', 'swipe-button'
    ]
  }
]

// --- Page ---

export default function ComponentPreviewPage() {
  const [date, setDate] = React.useState<Date | undefined>(new Date())
  const [progress, setProgress] = React.useState(45)
  const [checkCard1, setCheckCard1] = React.useState(false)
  const [checkCard2, setCheckCard2] = React.useState(true)
  const [switchVal, setSwitchVal] = React.useState(true)

  React.useEffect(() => {
    const timer = setInterval(() => {
      setProgress((p) => (p >= 100 ? 0 : p + 5))
    }, 500)
    return () => clearInterval(timer)
  }, [])

  return (
    <TooltipProvider>
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className="w-64 shrink-0 border-r border-border bg-card p-4 sticky top-0 h-screen overflow-y-auto hidden lg:block">
          <h1 className="text-lg font-semibold mb-4">Components</h1>
          {navSections.map((section) => (
            <div key={section.group} className="mb-4">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">
                {section.group}
              </p>
              <nav className="space-y-0.5">
                {section.items.map((item) => (
                  <a
                    key={item}
                    href={`#${item}`}
                    className="block px-2 py-1 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
                  >
                    {item
                      .split('-')
                      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                      .join(' ')}
                  </a>
                ))}
              </nav>
            </div>
          ))}
        </aside>

        {/* Main content */}
        <main className="flex-1 p-8 space-y-12 max-w-5xl">
          <div>
            <h1 className="text-4xl font-semibold mb-2">Component Preview</h1>
            <p className="text-muted-foreground">
              All Figma-mapped shadcn/ui components for the LaWallet dashboard.
            </p>
          </div>

          {/* ====== STANDARD SHADCN ====== */}

          <Section id="accordion" title="Accordion">
            <Accordion type="single" collapsible className="w-full max-w-md">
              <AccordionItem value="item-1">
                <AccordionTrigger>Is it accessible?</AccordionTrigger>
                <AccordionContent>
                  Yes. It adheres to the WAI-ARIA design pattern.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2">
                <AccordionTrigger>Is it styled?</AccordionTrigger>
                <AccordionContent>
                  Yes. It comes with default styles matching the design system.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-3">
                <AccordionTrigger>Is it animated?</AccordionTrigger>
                <AccordionContent>
                  Yes. Animated with CSS transitions by default.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Section>

          <Section id="alert" title="Alert">
            <Demo label="Default">
              <Alert>
                <Terminal className="h-4 w-4" />
                <AlertTitle>Heads up!</AlertTitle>
                <AlertDescription>
                  You can add components to your app using the CLI.
                </AlertDescription>
              </Alert>
            </Demo>
            <Demo label="Destructive">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>
                  Your session has expired. Please log in again.
                </AlertDescription>
              </Alert>
            </Demo>
          </Section>

          <Section id="alert-dialog" title="Alert Dialog">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline">Delete Account</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction>Continue</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Section>

          <Section id="aspect-ratio" title="Aspect Ratio">
            <Demo label="16:9">
              <div className="w-[450px] overflow-hidden rounded-md border">
                <AspectRatio ratio={16 / 9}>
                  <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground text-sm">
                    16:9 Aspect Ratio
                  </div>
                </AspectRatio>
              </div>
            </Demo>
            <Demo label="4:3">
              <div className="w-[300px] overflow-hidden rounded-md border">
                <AspectRatio ratio={4 / 3}>
                  <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground text-sm">
                    4:3 Aspect Ratio
                  </div>
                </AspectRatio>
              </div>
            </Demo>
            <Demo label="1:1">
              <div className="w-[200px] overflow-hidden rounded-md border">
                <AspectRatio ratio={1}>
                  <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground text-sm">
                    1:1 Square
                  </div>
                </AspectRatio>
              </div>
            </Demo>
          </Section>

          <Section id="avatar" title="Avatar">
            <Demo label="Variants">
              <Avatar>
                <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
                <AvatarFallback>CN</AvatarFallback>
              </Avatar>
              <Avatar>
                <AvatarFallback>JD</AvatarFallback>
              </Avatar>
              <Avatar>
                <AvatarFallback>LW</AvatarFallback>
              </Avatar>
            </Demo>
          </Section>

          <Section id="badge" title="Badge">
            <Demo label="Variants">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="destructive">Destructive</Badge>
            </Demo>
          </Section>

          <Section id="breadcrumb" title="Breadcrumb">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="#">Home</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink href="#">Dashboard</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Cards</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </Section>

          <Section id="button" title="Button">
            <Demo label="Variants">
              <Button>Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
            </Demo>
            <Demo label="Sizes">
              <Button size="sm">Small</Button>
              <Button size="default">Default</Button>
              <Button size="lg">Large</Button>
              <Button size="icon">
                <Plus />
              </Button>
            </Demo>
            <Demo label="States">
              <Button disabled>Disabled</Button>
              <Button disabled>
                <Loader2 className="animate-spin" /> Loading
              </Button>
            </Demo>
          </Section>

          <Section id="calendar" title="Calendar">
            <Calendar
              mode="single"
              numberOfMonths={2}
              selected={date}
              onSelect={setDate}
              className="rounded-md border"
            />
          </Section>

          <Section id="card" title="Card">
            <Card className="w-[350px]">
              <CardHeader>
                <CardTitle>Card Title</CardTitle>
                <CardDescription>Card description goes here.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Card content with relevant information.
                </p>
              </CardContent>
              <CardFooter className="flex justify-between">
                <Button variant="outline">Cancel</Button>
                <Button>Save</Button>
              </CardFooter>
            </Card>
          </Section>

          <Section id="carousel" title="Carousel">
            <Demo label="Default">
              <Carousel className="w-full max-w-xs">
                <CarouselContent>
                  {Array.from({ length: 5 }).map((_, index) => (
                    <CarouselItem key={index}>
                      <Card>
                        <CardContent className="flex aspect-square items-center justify-center p-6">
                          <span className="text-4xl font-semibold">{index + 1}</span>
                        </CardContent>
                      </Card>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious />
                <CarouselNext />
              </Carousel>
            </Demo>
            <Demo label="3 per view">
              <Carousel className="w-full max-w-md" opts={{ align: 'start' }}>
                <CarouselContent className="-ml-2">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <CarouselItem key={index} className="pl-2 basis-1/3">
                      <Card>
                        <CardContent className="flex aspect-square items-center justify-center p-4">
                          <span className="text-2xl font-semibold">{index + 1}</span>
                        </CardContent>
                      </Card>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious />
                <CarouselNext />
              </Carousel>
            </Demo>
          </Section>

          <Section id="checkbox" title="Checkbox">
            <Demo label="States">
              <div className="flex items-center space-x-2">
                <Checkbox id="terms" />
                <Label htmlFor="terms">Accept terms</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="checked" defaultChecked />
                <Label htmlFor="checked">Checked</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="disabled" disabled />
                <Label htmlFor="disabled">Disabled</Label>
              </div>
            </Demo>
          </Section>

          <Section id="collapsible" title="Collapsible">
            <Collapsible className="w-[350px] space-y-2">
              <div className="flex items-center justify-between space-x-4 px-4">
                <h4 className="text-sm font-semibold">3 starred repositories</h4>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <ChevronsUpDown className="h-4 w-4" />
                    <span className="sr-only">Toggle</span>
                  </Button>
                </CollapsibleTrigger>
              </div>
              <div className="rounded-md border px-4 py-3 font-mono text-sm">
                @radix-ui/primitives
              </div>
              <CollapsibleContent className="space-y-2">
                <div className="rounded-md border px-4 py-3 font-mono text-sm">
                  @radix-ui/colors
                </div>
                <div className="rounded-md border px-4 py-3 font-mono text-sm">
                  @stitches/react
                </div>
              </CollapsibleContent>
            </Collapsible>
          </Section>

          <Section id="command" title="Command">
            <Command className="rounded-lg border shadow-md max-w-md">
              <CommandInput placeholder="Type a command or search..." />
              <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup heading="Suggestions">
                  <CommandItem>
                    <CalendarIcon className="mr-2 h-4 w-4" /> Calendar
                  </CommandItem>
                  <CommandItem>
                    <Mail className="mr-2 h-4 w-4" /> Mail
                  </CommandItem>
                  <CommandItem>
                    <Settings className="mr-2 h-4 w-4" /> Settings
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="Actions">
                  <CommandItem>
                    <User className="mr-2 h-4 w-4" /> Profile
                    <CommandShortcut>⌘P</CommandShortcut>
                  </CommandItem>
                  <CommandItem>
                    <CreditCard className="mr-2 h-4 w-4" /> Billing
                    <CommandShortcut>⌘B</CommandShortcut>
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </Section>

          <Section id="context-menu" title="Context Menu">
            <Demo label="Right-click the area">
              <ContextMenu>
                <ContextMenuTrigger className="flex h-[150px] w-[300px] items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
                  Right click here
                </ContextMenuTrigger>
                <ContextMenuContent className="w-64">
                  <ContextMenuItem>
                    Back <ContextMenuShortcut>⌘[</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuItem>
                    Forward <ContextMenuShortcut>⌘]</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuItem>
                    Reload <ContextMenuShortcut>⌘R</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuLabel>More Tools</ContextMenuLabel>
                  <ContextMenuItem>Save Page As...</ContextMenuItem>
                  <ContextMenuItem>View Page Source</ContextMenuItem>
                  <ContextMenuItem>Inspect</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </Demo>
          </Section>

          <Section id="dialog" title="Dialog">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Edit Profile</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit profile</DialogTitle>
                  <DialogDescription>
                    Make changes to your profile here.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" defaultValue="Pedro Duarte" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="username">Username</Label>
                    <Input id="username" defaultValue="@peduarte" />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit">Save changes</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Section>

          <Section id="dropdown-menu" title="Dropdown Menu">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  Open Menu <ChevronDown className="ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" /> Profile
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings className="mr-2 h-4 w-4" /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Section>

          <Section id="drawer" title="Drawer">
            <Drawer>
              <DrawerTrigger asChild>
                <Button variant="outline">Open Drawer</Button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Move Goal</DrawerTitle>
                  <DrawerDescription>Set your daily activity goal.</DrawerDescription>
                </DrawerHeader>
                <div className="p-4">
                  <Slider defaultValue={[350]} max={500} step={10} />
                </div>
                <DrawerFooter>
                  <Button>Submit</Button>
                  <DrawerClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DrawerClose>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
          </Section>

          <Section id="hover-card" title="Hover Card">
            <Demo label="Hover to reveal">
              <HoverCard>
                <HoverCardTrigger asChild>
                  <Button variant="link">@shadcn</Button>
                </HoverCardTrigger>
                <HoverCardContent className="w-80">
                  <div className="flex gap-4">
                    <Avatar>
                      <AvatarImage src="https://github.com/shadcn.png" />
                      <AvatarFallback>SC</AvatarFallback>
                    </Avatar>
                    <div className="space-y-1">
                      <h4 className="text-sm font-semibold">@shadcn</h4>
                      <p className="text-sm text-muted-foreground">
                        The creator of shadcn/ui and taxonomy.
                      </p>
                      <div className="flex items-center pt-2">
                        <CalendarIcon className="mr-2 h-4 w-4 opacity-70" />
                        <span className="text-xs text-muted-foreground">Joined Dec 2021</span>
                      </div>
                    </div>
                  </div>
                </HoverCardContent>
              </HoverCard>
            </Demo>
          </Section>

          <Section id="input" title="Input">
            <Demo label="Types">
              <Input placeholder="Default input" className="max-w-sm" />
              <Input type="email" placeholder="Email" className="max-w-sm" />
              <Input type="password" placeholder="Password" className="max-w-sm" />
              <Input disabled placeholder="Disabled" className="max-w-sm" />
            </Demo>
          </Section>

          <Section id="input-otp" title="Input OTP">
            <Demo label="6 Digits">
              <InputOTP maxLength={6}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </Demo>
            <Demo label="With Separator">
              <InputOTP maxLength={6}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </Demo>
            <Demo label="Pattern (digits only)">
              <InputOTP maxLength={6} pattern="^[0-9]+$">
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </Demo>
          </Section>

          <Section id="label" title="Label">
            <div className="grid gap-2 max-w-sm">
              <Label htmlFor="label-demo">Email</Label>
              <Input id="label-demo" placeholder="you@example.com" />
            </div>
          </Section>

          <Section id="menubar" title="Menubar">
            <Menubar>
              <MenubarMenu>
                <MenubarTrigger>File</MenubarTrigger>
                <MenubarContent>
                  <MenubarItem>New Tab <MenubarShortcut>⌘T</MenubarShortcut></MenubarItem>
                  <MenubarItem>New Window <MenubarShortcut>⌘N</MenubarShortcut></MenubarItem>
                  <MenubarSeparator />
                  <MenubarItem>Print <MenubarShortcut>⌘P</MenubarShortcut></MenubarItem>
                </MenubarContent>
              </MenubarMenu>
              <MenubarMenu>
                <MenubarTrigger>Edit</MenubarTrigger>
                <MenubarContent>
                  <MenubarItem>Undo <MenubarShortcut>⌘Z</MenubarShortcut></MenubarItem>
                  <MenubarItem>Redo <MenubarShortcut>⇧⌘Z</MenubarShortcut></MenubarItem>
                  <MenubarSeparator />
                  <MenubarItem>Cut</MenubarItem>
                  <MenubarItem>Copy</MenubarItem>
                  <MenubarItem>Paste</MenubarItem>
                </MenubarContent>
              </MenubarMenu>
              <MenubarMenu>
                <MenubarTrigger>View</MenubarTrigger>
                <MenubarContent>
                  <MenubarItem>Zoom In</MenubarItem>
                  <MenubarItem>Zoom Out</MenubarItem>
                  <MenubarSeparator />
                  <MenubarItem>Toggle Fullscreen</MenubarItem>
                </MenubarContent>
              </MenubarMenu>
            </Menubar>
          </Section>

          <Section id="navigation-menu" title="Navigation Menu">
            <NavigationMenu>
              <NavigationMenuList>
                <NavigationMenuItem>
                  <NavigationMenuTrigger>Getting Started</NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="grid gap-3 p-6 w-[400px]">
                      <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                        Introduction
                      </NavigationMenuLink>
                      <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                        Installation
                      </NavigationMenuLink>
                      <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                        Typography
                      </NavigationMenuLink>
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
                <NavigationMenuItem>
                  <NavigationMenuTrigger>Components</NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="grid gap-3 p-6 w-[400px]">
                      <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                        Alert Dialog
                      </NavigationMenuLink>
                      <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                        Hover Card
                      </NavigationMenuLink>
                      <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                        Progress
                      </NavigationMenuLink>
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
          </Section>

          <Section id="pagination" title="Pagination">
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious href="#" />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href="#">1</PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href="#" isActive>2</PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href="#">3</PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationEllipsis />
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext href="#" />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </Section>

          <Section id="popover" title="Popover">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Open Popover</Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <div className="grid gap-4">
                  <h4 className="font-medium leading-none">Dimensions</h4>
                  <p className="text-sm text-muted-foreground">
                    Set the dimensions for the layer.
                  </p>
                  <div className="grid gap-2">
                    <Label htmlFor="width">Width</Label>
                    <Input id="width" defaultValue="100%" />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </Section>

          <Section id="progress" title="Progress">
            <Demo label="Animated">
              <Progress value={progress} className="w-full max-w-md" />
            </Demo>
            <Demo label="Static values">
              <Progress value={25} className="w-full max-w-md" />
              <Progress value={50} className="w-full max-w-md" />
              <Progress value={75} className="w-full max-w-md" />
            </Demo>
          </Section>

          <Section id="radio-group" title="Radio Group">
            <RadioGroup defaultValue="option-1">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="option-1" id="option-1" />
                <Label htmlFor="option-1">Default</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="option-2" id="option-2" />
                <Label htmlFor="option-2">Comfortable</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="option-3" id="option-3" />
                <Label htmlFor="option-3">Compact</Label>
              </div>
            </RadioGroup>
          </Section>

          <Section id="resizable" title="Resizable">
            <Demo label="Horizontal">
              <ResizablePanelGroup orientation="horizontal" className="max-w-md rounded-lg border">
                <ResizablePanel defaultSize={50}>
                  <div className="flex h-[200px] items-center justify-center p-6">
                    <span className="font-semibold">Panel A</span>
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={50}>
                  <div className="flex h-[200px] items-center justify-center p-6">
                    <span className="font-semibold">Panel B</span>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </Demo>
            <Demo label="Vertical">
              <ResizablePanelGroup orientation="vertical" className="min-h-[200px] max-w-md rounded-lg border">
                <ResizablePanel defaultSize={30}>
                  <div className="flex h-full items-center justify-center p-6">
                    <span className="font-semibold">Header</span>
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={70}>
                  <div className="flex h-[150px] items-center justify-center p-6">
                    <span className="font-semibold">Content</span>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </Demo>
          </Section>

          <Section id="scroll-area" title="Scroll Area">
            <ScrollArea className="h-48 w-48 rounded-md border p-4">
              {Array.from({ length: 20 }).map((_, i) => (
                <div key={i} className="text-sm py-1">
                  Item {i + 1}
                </div>
              ))}
            </ScrollArea>
          </Section>

          <Section id="select" title="Select">
            <Select>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select a fruit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="apple">Apple</SelectItem>
                <SelectItem value="banana">Banana</SelectItem>
                <SelectItem value="orange">Orange</SelectItem>
                <SelectItem value="grape">Grape</SelectItem>
              </SelectContent>
            </Select>
          </Section>

          <Section id="separator" title="Separator">
            <div className="max-w-md">
              <p className="text-sm">Above separator</p>
              <Separator className="my-4" />
              <p className="text-sm">Below separator</p>
              <div className="flex items-center gap-4 mt-4">
                <span className="text-sm">Left</span>
                <Separator orientation="vertical" className="h-6" />
                <span className="text-sm">Right</span>
              </div>
            </div>
          </Section>

          <Section id="sheet" title="Sheet">
            <Demo label="Sides">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline">Open Right</Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Edit profile</SheetTitle>
                    <SheetDescription>
                      Make changes to your profile here. Click save when done.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="sheet-name">Name</Label>
                      <Input id="sheet-name" defaultValue="Pedro Duarte" />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="sheet-username">Username</Label>
                      <Input id="sheet-username" defaultValue="@peduarte" />
                    </div>
                  </div>
                  <Button>Save changes</Button>
                </SheetContent>
              </Sheet>
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline">Open Left</Button>
                </SheetTrigger>
                <SheetContent side="left">
                  <SheetHeader>
                    <SheetTitle>Navigation</SheetTitle>
                    <SheetDescription>Browse the application.</SheetDescription>
                  </SheetHeader>
                  <nav className="grid gap-2 py-4">
                    <Button variant="ghost" className="justify-start"><Home className="mr-2 h-4 w-4" /> Home</Button>
                    <Button variant="ghost" className="justify-start"><Settings className="mr-2 h-4 w-4" /> Settings</Button>
                    <Button variant="ghost" className="justify-start"><User className="mr-2 h-4 w-4" /> Profile</Button>
                  </nav>
                </SheetContent>
              </Sheet>
            </Demo>
          </Section>

          <Section id="skeleton" title="Skeleton">
            <Demo label="Loading states">
              <div className="flex items-center space-x-4">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-[250px]" />
                  <Skeleton className="h-4 w-[200px]" />
                </div>
              </div>
            </Demo>
          </Section>

          <Section id="slider" title="Slider">
            <Slider defaultValue={[50]} max={100} step={1} className="w-full max-w-md" />
          </Section>

          <Section id="sonner" title="Sonner (Toast)">
            <Demo label="Variants">
              <Button
                variant="outline"
                onClick={() => toast('Event has been created', {
                  description: 'Sunday, December 03, 2023 at 9:00 AM'
                })}
              >
                Show Toast
              </Button>
              <Button
                variant="outline"
                onClick={() => toast.success('Profile updated successfully')}
              >
                Success
              </Button>
              <Button
                variant="outline"
                onClick={() => toast.error('Something went wrong')}
              >
                Error
              </Button>
              <Button
                variant="outline"
                onClick={() => toast.warning('Please check your input')}
              >
                Warning
              </Button>
              <Button
                variant="outline"
                onClick={() => toast('Action required', {
                  action: { label: 'Undo', onClick: () => {} }
                })}
              >
                With Action
              </Button>
            </Demo>
          </Section>

          <Section id="switch" title="Switch">
            <Demo label="States">
              <div className="flex items-center space-x-2">
                <Switch
                  id="switch-demo"
                  checked={switchVal}
                  onCheckedChange={setSwitchVal}
                />
                <Label htmlFor="switch-demo">
                  {switchVal ? 'Enabled' : 'Disabled'}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch disabled />
                <Label>Disabled</Label>
              </div>
            </Demo>
          </Section>

          <Section id="table" title="Table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Success</TableCell>
                  <TableCell>ken99@example.com</TableCell>
                  <TableCell className="text-right">$316.00</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Processing</TableCell>
                  <TableCell>abe45@example.com</TableCell>
                  <TableCell className="text-right">$242.00</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Failed</TableCell>
                  <TableCell>monserrat44@example.com</TableCell>
                  <TableCell className="text-right">$837.00</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Section>

          <Section id="tabs" title="Tabs">
            <Tabs defaultValue="account" className="w-full max-w-md">
              <TabsList>
                <TabsTrigger value="account">Account</TabsTrigger>
                <TabsTrigger value="password">Password</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
              <TabsContent value="account">
                <p className="text-sm text-muted-foreground p-4">
                  Account settings content.
                </p>
              </TabsContent>
              <TabsContent value="password">
                <p className="text-sm text-muted-foreground p-4">
                  Password settings content.
                </p>
              </TabsContent>
              <TabsContent value="settings">
                <p className="text-sm text-muted-foreground p-4">
                  General settings content.
                </p>
              </TabsContent>
            </Tabs>
          </Section>

          <Section id="textarea" title="Textarea">
            <Textarea placeholder="Type your message here." className="max-w-md" />
          </Section>

          <Section id="toggle" title="Toggle">
            <Demo label="Variants">
              <Toggle aria-label="Toggle bold">
                <Bold className="h-4 w-4" />
              </Toggle>
              <Toggle variant="outline" aria-label="Toggle italic">
                <Italic className="h-4 w-4" />
              </Toggle>
              <Toggle disabled aria-label="Toggle underline">
                <Underline className="h-4 w-4" />
              </Toggle>
            </Demo>
          </Section>

          <Section id="toggle-group" title="Toggle Group">
            <ToggleGroup type="multiple">
              <ToggleGroupItem value="bold" aria-label="Toggle bold">
                <Bold className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="italic" aria-label="Toggle italic">
                <Italic className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="underline" aria-label="Toggle underline">
                <Underline className="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>
          </Section>

          <Section id="tooltip" title="Tooltip">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">Hover me</Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>This is a tooltip</p>
              </TooltipContent>
            </Tooltip>
          </Section>

          {/* ====== CUSTOM COMPONENTS ====== */}

          <div className="pt-8">
            <h2 className="text-3xl font-semibold mb-2 text-foreground">
              Custom Components
            </h2>
            <p className="text-muted-foreground mb-8">
              Components created from the Figma design system.
            </p>
          </div>

          <Section id="spinner" title="Spinner">
            <Demo label="Sizes">
              <Spinner size={12} />
              <Spinner size={16} />
              <Spinner size={24} />
              <Spinner size={32} />
            </Demo>
            <Demo label="Colors">
              <Spinner color="default" />
              <Spinner color="red" />
              <Spinner color="green" />
              <Spinner color="blue" />
              <Spinner color="yellow" />
            </Demo>
            <Demo label="In Button">
              <Button disabled>
                <Spinner size={16} className="mr-2" /> Loading...
              </Button>
              <Button variant="outline" disabled>
                <Spinner size={16} className="mr-2" /> Processing
              </Button>
            </Demo>
            <Demo label="In Badge">
              <Badge>
                <Spinner size={12} className="mr-1" /> Syncing
              </Badge>
              <Badge variant="secondary">
                <Spinner size={12} className="mr-1" /> Updating
              </Badge>
              <Badge variant="outline">
                <Spinner size={12} className="mr-1" /> Processing
              </Badge>
            </Demo>
          </Section>

          <Section id="kbd" title="Kbd">
            <Demo label="Keys">
              <Kbd>⌘</Kbd>
              <Kbd>⇧</Kbd>
              <Kbd>⌥</Kbd>
              <Kbd>⌃</Kbd>
              <Kbd>Enter</Kbd>
              <Kbd>Esc</Kbd>
            </Demo>
            <Demo label="Combo">
              <div className="flex items-center gap-1">
                <Kbd>Ctrl</Kbd>
                <span className="text-muted-foreground">+</span>
                <Kbd>B</Kbd>
              </div>
              <div className="flex items-center gap-1">
                <Kbd>⌘</Kbd>
                <span className="text-muted-foreground">+</span>
                <Kbd>K</Kbd>
              </div>
            </Demo>
            <Demo label="In Button">
              <Button variant="outline" className="gap-3">
                Accept
                <Kbd>Enter</Kbd>
              </Button>
              <Button variant="outline" className="gap-3">
                Cancel
                <Kbd>Esc</Kbd>
              </Button>
            </Demo>
          </Section>

          <Section id="button-group" title="Button Group">
            <Demo label="Horizontal">
              <ButtonGroup>
                <Button variant="outline" size="icon">
                  <ArrowLeft />
                </Button>
                <Button variant="outline">Archive</Button>
                <Button variant="outline">Report</Button>
              </ButtonGroup>
            </Demo>
            <Demo label="Vertical">
              <ButtonGroup orientation="vertical">
                <Button variant="outline" size="icon">
                  <Plus />
                </Button>
                <Button variant="outline" size="icon">
                  <Minus />
                </Button>
              </ButtonGroup>
            </Demo>
            <Demo label="Segmented">
              <ButtonGroup>
                <Button variant="outline" size="sm">
                  Small
                </Button>
                <Button variant="outline" size="sm">
                  Button
                </Button>
                <Button variant="outline" size="sm">
                  Group
                </Button>
              </ButtonGroup>
            </Demo>
            <Demo label="Pagination">
              <ButtonGroup>
                <Button variant="outline" size="icon">
                  <ArrowLeft />
                </Button>
                <Button variant="outline">1</Button>
                <Button variant="outline">2</Button>
                <Button variant="outline">3</Button>
                <Button variant="outline" size="icon">
                  <ArrowRight />
                </Button>
              </ButtonGroup>
            </Demo>
          </Section>

          <Section id="checkbox-card" title="Checkbox Card">
            <Demo label="States">
              <CheckboxCard
                checked={checkCard1}
                onCheckedChange={setCheckCard1}
                title="Enable notifications"
                description="You can enable or disable notifications at any time."
              />
              <CheckboxCard
                checked={checkCard2}
                onCheckedChange={setCheckCard2}
                title="Dark mode"
                description="Use dark theme across the dashboard."
              />
              <CheckboxCard
                disabled
                title="Maintenance mode"
                description="This option is not available right now."
              />
            </Demo>
          </Section>

          <Section id="link-card" title="Link Card">
            <Demo label="Default">
              <LinkCard href="#" type="default">
                <LinkCardTitle>Visit our documentation</LinkCardTitle>
                <LinkCardDescription>
                  Learn how to get started with the platform.
                </LinkCardDescription>
              </LinkCard>
            </Demo>
            <Demo label="Outline">
              <LinkCard href="#" type="outline">
                <LinkCardTitle>External resource</LinkCardTitle>
                <LinkCardDescription>
                  Opens in a new tab for additional reading.
                </LinkCardDescription>
              </LinkCard>
            </Demo>
          </Section>

          <Section id="native-select" title="Native Select">
            <Demo label="Default">
              <NativeSelect placeholder="Select a status" className="w-[200px]">
                <option value="todo">Todo</option>
                <option value="progress">In Progress</option>
                <option value="done">Done</option>
                <option value="cancelled">Cancelled</option>
              </NativeSelect>
            </Demo>
            <Demo label="With Groups">
              <NativeSelect placeholder="Select department" className="w-[200px]">
                <optgroup label="Engineering">
                  <option>Frontend</option>
                  <option>Backend</option>
                  <option>DevOps</option>
                </optgroup>
                <optgroup label="Sales">
                  <option>Sales Rep</option>
                  <option>Account Manager</option>
                </optgroup>
              </NativeSelect>
            </Demo>
            <Demo label="Error">
              <NativeSelect error placeholder="Select role" className="w-[200px]">
                <option value="admin">Admin</option>
                <option value="user">User</option>
              </NativeSelect>
            </Demo>
            <Demo label="Disabled">
              <NativeSelect disabled placeholder="Select priority" className="w-[200px]">
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </NativeSelect>
            </Demo>
          </Section>

          <Section id="input-group" title="Input Group">
            <Demo label="With Icon">
              <InputGroup className="max-w-sm">
                <InputGroupPrefix>
                  <Search />
                </InputGroupPrefix>
                <Input
                  placeholder="Search..."
                  className="border-0 shadow-none focus-visible:ring-0"
                />
              </InputGroup>
            </Demo>
            <Demo label="With Suffix Text">
              <InputGroup className="max-w-sm">
                <InputGroupPrefix>
                  <Search />
                </InputGroupPrefix>
                <Input
                  placeholder="Search items..."
                  className="border-0 shadow-none focus-visible:ring-0"
                />
                <InputGroupSuffix>
                  <span className="text-sm">12 results</span>
                </InputGroupSuffix>
              </InputGroup>
            </Demo>
            <Demo label="URL Builder">
              <InputGroup className="max-w-md">
                <InputGroupText position="prefix">https://</InputGroupText>
                <Input
                  placeholder="example"
                  className="border-0 shadow-none focus-visible:ring-0"
                />
                <InputGroupText position="suffix">.com</InputGroupText>
              </InputGroup>
            </Demo>
            <Demo label="Currency">
              <InputGroup className="max-w-xs">
                <InputGroupText position="prefix">$</InputGroupText>
                <Input
                  placeholder="0.00"
                  className="border-0 shadow-none focus-visible:ring-0"
                />
                <InputGroupText position="suffix">USD</InputGroupText>
              </InputGroup>
            </Demo>
            <Demo label="With Mail Icon">
              <InputGroup className="max-w-sm">
                <InputGroupPrefix>
                  <Mail />
                </InputGroupPrefix>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  className="border-0 shadow-none focus-visible:ring-0"
                />
              </InputGroup>
            </Demo>
          </Section>

          <Section id="field" title="Field">
            <Demo label="Input Field">
              <Field className="max-w-sm w-full">
                <FieldLabel>Username</FieldLabel>
                <Input placeholder="Enter username" />
                <FieldDescription>This is your public display name.</FieldDescription>
              </Field>
            </Demo>
            <Demo label="With Error">
              <Field className="max-w-sm w-full">
                <FieldLabel>Email</FieldLabel>
                <Input placeholder="you@example.com" className="border-destructive" />
                <FieldError>Please enter a valid email address.</FieldError>
              </Field>
            </Demo>
            <Demo label="Textarea">
              <Field className="max-w-sm w-full">
                <FieldLabel>Feedback</FieldLabel>
                <Textarea placeholder="Tell us what you think..." />
                <FieldDescription>Max 500 characters.</FieldDescription>
              </Field>
            </Demo>
            <Demo label="Select">
              <Field className="max-w-sm w-full">
                <FieldLabel>Department</FieldLabel>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="eng">Engineering</SelectItem>
                    <SelectItem value="sales">Sales</SelectItem>
                    <SelectItem value="ops">Operations</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>Choose your team.</FieldDescription>
              </Field>
            </Demo>
            <Demo label="Fieldset">
              <Fieldset className="max-w-md w-full">
                <FieldsetLegend>Address</FieldsetLegend>
                <FieldsetDescription>
                  Enter your mailing address.
                </FieldsetDescription>
                <Field>
                  <FieldLabel>Street</FieldLabel>
                  <Input placeholder="123 Main St" />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel>City</FieldLabel>
                    <Input placeholder="Buenos Aires" />
                  </Field>
                  <Field>
                    <FieldLabel>Postal Code</FieldLabel>
                    <Input placeholder="C1000" />
                  </Field>
                </div>
              </Fieldset>
            </Demo>
          </Section>

          <Section id="topbar" title="Topbar">
            <Demo label="Page">
              <div className="w-full border border-border rounded-lg overflow-hidden">
                <Topbar
                  title="Dashboard"
                  subtitle="Overview of your system"
                  type="page"
                  actions={
                    <>
                      <Button variant="secondary">Cancel</Button>
                      <Button>Save Changes</Button>
                    </>
                  }
                />
              </div>
            </Demo>
            <Demo label="Subpage with Tabs">
              <div className="w-full border border-border rounded-lg overflow-hidden">
                <Topbar
                  title="Cards"
                  subtitle="Manage your cards"
                  type="subpage"
                  tabs={[
                    { label: 'All Cards', active: true, onClick: () => {} },
                    { label: 'Paired', onClick: () => {} },
                    { label: 'Unpaired', onClick: () => {} }
                  ]}
                  actions={
                    <Button>
                      <Plus className="mr-2 h-4 w-4" /> New Card
                    </Button>
                  }
                />
              </div>
            </Demo>
            <Demo label="With Alert">
              <div className="w-full border border-border rounded-lg overflow-hidden">
                <Topbar
                  title="Settings"
                  subtitle="System configuration"
                  type="page"
                  alert={{
                    title: 'System Disabled',
                    message: 'The system is currently in maintenance mode.',
                    action: 'Enable',
                    onAction: () => {}
                  }}
                  actions={<Button>Save</Button>}
                />
              </div>
            </Demo>
          </Section>

          <Section id="topbar-mobile" title="Topbar Mobile">
            <Demo label="Page">
              <div className="w-[375px] border border-border rounded-lg overflow-hidden">
                <TopbarMobile type="page" avatar="https://github.com/shadcn.png" />
              </div>
            </Demo>
            <Demo label="Subpage">
              <div className="w-[375px] border border-border rounded-lg overflow-hidden">
                <TopbarMobile
                  type="subpage"
                  title="Card Details"
                  onBack={() => {}}
                />
              </div>
            </Demo>
          </Section>

          <Section id="swipe-button" title="Swipe Button">
            <Demo label="Interactive">
              <div className="w-[343px]">
                <SwipeButton
                  onConfirm={async () => {
                    await new Promise((r) => setTimeout(r, 2000))
                  }}
                />
              </div>
            </Demo>
            <Demo label="Custom Labels">
              <div className="w-[343px]">
                <SwipeButton
                  label="Slide to Pay"
                  activeLabel="Release to Pay"
                  loadingLabel="Processing..."
                  onConfirm={async () => {
                    await new Promise((r) => setTimeout(r, 1500))
                  }}
                />
              </div>
            </Demo>
            <Demo label="Disabled">
              <div className="w-[343px]">
                <SwipeButton disabled />
              </div>
            </Demo>
          </Section>
        </main>
      </div>
    </TooltipProvider>
  )
}

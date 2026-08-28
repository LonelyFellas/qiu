/**
 * page-flip@2.0.7（StPageFlip）没有随包发布类型声明，这里只声明用得到的部分。
 * 直接指向 ESM 产物：包的 main 字段指的是 UMD 版本，走 CJS interop 没必要。
 */
declare module 'page-flip/dist/js/page-flip.module.js' {
  export interface PageFlipSettings {
    startPage: number
    size: 'fixed' | 'stretch'
    width: number
    height: number
    minWidth: number
    maxWidth: number
    minHeight: number
    maxHeight: number
    drawShadow: boolean
    flippingTime: number
    usePortrait: boolean
    startZIndex: number
    autoSize: boolean
    maxShadowOpacity: number
    showCover: boolean
    mobileScrollSupport: boolean
    swipeDistance: number
    clickEventForward: boolean
    useMouseEvents: boolean
    showPageCorners: boolean
    disableFlipByClick: boolean
  }

  export type PageFlipEvent = 'flip' | 'changeState' | 'changeOrientation' | 'init' | 'update'

  export class PageFlip {
    constructor(element: HTMLElement, settings: Partial<PageFlipSettings>)
    loadFromHTML(items: NodeListOf<Element> | HTMLElement[]): void
    on(event: PageFlipEvent, callback: (e: { data: unknown; object: PageFlip }) => void): PageFlip
    turnToPage(page: number): void
    flipNext(corner?: 'top' | 'bottom'): void
    flipPrev(corner?: 'top' | 'bottom'): void
    getCurrentPageIndex(): number
    getPageCount(): number
    getRender(): unknown
    destroy(): void
  }
}

import { TestBed } from '@angular/core/testing';
import { QrComponent } from './qr';

describe('QrComponent', () => {
  it('dibuja un QR con módulos oscuros y un aria-label con el código', () => {
    const f = TestBed.createComponent(QrComponent);
    f.componentRef.setInput('texto', 'BK-57301B29');
    f.detectChanges();
    const svg = f.nativeElement.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('aria-label')).toContain('BK-57301B29');
    expect((svg.querySelector('path')!.getAttribute('d') ?? '').length).toBeGreaterThan(200);
  });
});

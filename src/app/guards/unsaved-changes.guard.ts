import { Injectable } from '@angular/core';
import { CanDeactivate } from '@angular/router';
import { AnalizComponent } from '../analiz/analiz.component';

@Injectable({
  providedIn: 'root'
})
export class UnsavedChangesGuard implements CanDeactivate<AnalizComponent> {
  canDeactivate(component: AnalizComponent): boolean | Promise<boolean> {
    if (component.hasUnsavedChanges()) {
      return component.showCustomAlert(
        'Vazgeçme Onayı',
        'Kaydedilmemiş geometri değişiklikleriniz var. Sayfadan ayrılırsanız bu değişiklikler kaybolacaktır.',
        'confirm'
      );
    }
    return true;
  }
}

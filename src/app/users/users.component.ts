import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { UserService } from '../services/user.service';
import { AuthService } from '../services/auth.service';
import { UserDto } from '../models/user.model';

const PASSWORD_PATTERN = /^(?=.*[a-zçğıöşü])(?=.*[A-ZÇĞİÖŞÜ])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])[^\s]{8,64}$/;

@Component({
  selector: 'app-users',
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.scss']
})
export class UsersComponent implements OnInit {
  users: UserDto[] = [];
  isLoading: boolean = false;

  // Modal Durumları
  isModalOpen: boolean = false;
  isEditMode: boolean = false;
  selectedUserId?: number;
  userForm!: FormGroup;

  // Bilgi Alert Dialog Durumları
  isInfoAlertOpen: boolean = false;
  infoAlertTitle: string = '';
  infoAlertMessage: string = '';

  openInfoAlert(title: string, message: string): void {
    this.infoAlertTitle = title;
    this.infoAlertMessage = message;
    this.isInfoAlertOpen = true;
  }

  closeInfoAlert(): void {
    this.isInfoAlertOpen = false;
  }

  // Custom Confirm Modal Dialog Durumları
  isConfirmModalOpen: boolean = false;
  confirmModalTitle: string = '';
  confirmModalMessage: string = '';
  confirmCallback: () => void = () => {};

  openConfirmModal(title: string, message: string, onConfirm: () => void): void {
    this.confirmModalTitle = title;
    this.confirmModalMessage = message;
    this.confirmCallback = onConfirm;
    this.isConfirmModalOpen = true;
  }

  closeConfirmModal(): void {
    this.isConfirmModalOpen = false;
  }

  onConfirmAction(): void {
    this.isConfirmModalOpen = false;
    if (this.confirmCallback) {
      this.confirmCallback();
    }
  }

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private userService: UserService,
    public authService: AuthService
  ) {}

  ngOnInit(): void {
    this.initForm();
    this.loadUsers();
  }

  initForm(): void {
    this.userForm = this.fb.group({
      kullaniciAdi: ['', [Validators.required, Validators.minLength(3)]],
      email: ['', [Validators.required, Validators.email]],
      sifre: ['', [Validators.pattern(PASSWORD_PATTERN)]],
      rol: ['User', Validators.required]
    });
  }

  loadUsers(): void {
    this.isLoading = true;
    this.userService.getAll().subscribe({
      next: (res) => {
        this.users = res || [];
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Kullanıcılar yüklenirken hata oluştu:', err);
        this.isLoading = false;
      }
    });
  }

  openAddModal(): void {
    this.isEditMode = false;
    this.selectedUserId = undefined;
    this.userForm.reset({ rol: 'User' });
    
    // Ekleme modunda şifre alanı zorunlu olmalı ve desen gereksinimlerini sağlamalı
    this.userForm.get('sifre')?.setValidators([Validators.required, Validators.pattern(PASSWORD_PATTERN)]);
    this.userForm.get('sifre')?.updateValueAndValidity();
    
    this.isModalOpen = true;
  }

  openEditModal(user: UserDto): void {
    this.isEditMode = true;
    this.selectedUserId = user.id;
    this.userForm.patchValue({
      kullaniciAdi: user.kullaniciAdi,
      email: user.email,
      sifre: '', // Düzenleme modunda şifre boş bırakılırsa güncellenmez
      rol: user.rol
    });
    
    // Düzenleme modunda şifre alanı isteğe bağlı ancak girilirse desene uymak zorunda
    this.userForm.get('sifre')?.setValidators([Validators.pattern(PASSWORD_PATTERN)]);
    this.userForm.get('sifre')?.updateValueAndValidity();
    
    this.isModalOpen = true;
  }

  closeModal(): void {
    this.isModalOpen = false;
  }

  onSubmit(): void {
    if (this.userForm.valid) {
      const formValue = this.userForm.value;
      const userDto: UserDto = {
        kullaniciAdi: formValue.kullaniciAdi,
        email: formValue.email,
        rol: formValue.rol
      };

      if (formValue.sifre) {
        userDto.sifre = formValue.sifre;
      }

      if (this.isEditMode && this.selectedUserId !== undefined) {
        // Güncelleme işlemi
        this.userService.update(this.selectedUserId, userDto).subscribe({
          next: () => {
            this.closeModal();
            this.loadUsers();
            this.openInfoAlert('Başarılı', 'Kullanıcı bilgileri başarıyla güncellendi.');
          },
          error: (err) => {
            console.error('Kullanıcı güncellenirken hata:', err);
            this.openInfoAlert('Hata', err.error || 'Güncelleme başarısız oldu.');
          }
        });
      } else {
        // Ekleme işlemi
        if (!userDto.sifre) {
          this.openInfoAlert('Uyarı', 'Şifre alanı zorunludur.');
          return;
        }
        this.userService.add(userDto).subscribe({
          next: () => {
            this.closeModal();
            this.loadUsers();
            this.openInfoAlert('Başarılı', 'Kullanıcı hesabı başarıyla eklendi.');
          },
          error: (err) => {
            console.error('Kullanıcı eklenirken hata:', err);
            this.openInfoAlert('Hata', err.error || 'Ekleme başarısız oldu.');
          }
        });
      }
    } else {
      this.userForm.markAllAsTouched();
    }
  }

  deleteUser(id: number): void {
    this.openConfirmModal(
      'Kullanıcıyı Sil',
      'Bu kullanıcıyı silmek istediğinize emin misiniz?',
      () => {
        this.userService.delete(id).subscribe({
          next: () => {
            this.loadUsers();
            this.openInfoAlert('Başarılı', 'Kullanıcı hesabı başarıyla silindi.');
          },
          error: (err) => {
            console.error('Kullanıcı silinirken hata:', err);
            this.openInfoAlert('Hata', err.error || 'Silme işlemi başarısız oldu.');
          }
        });
      }
    );
  }

  checkPasswordRequirement(rule: string): boolean {
    const sifre = this.userForm?.get('sifre')?.value || '';
    switch (rule) {
      case 'length':
        return sifre.length >= 8 && sifre.length <= 64;
      case 'lowercase':
        return /[a-zçğıöşü]/.test(sifre);
      case 'uppercase':
        return /[A-ZÇĞİÖŞÜ]/.test(sifre);
      case 'digit':
        return /\d/.test(sifre);
      case 'special':
        return /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(sifre);
      case 'noSpace':
        return sifre.length > 0 && !/\s/.test(sifre);
      default:
        return false;
    }
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}

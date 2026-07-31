import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss']
})
export class RegisterComponent implements OnInit {
  registerForm!: FormGroup;
  errorMessage = '';
  isInfoAlertOpen = false;
  infoAlertTitle = '';
  infoAlertMessage = '';
  isSuccess = false;

  // Şifre gereksinimlerinin durum takibi
  passwordRequirements = {
    length: false,      // 8-64 karakter
    lowercase: false,   // En az bir küçük harf
    uppercase: false,   // En az bir büyük harf
    digit: false,       // En az bir rakam
    special: false,     // En az bir özel karakter
    noSpace: false      // Boşluk olmamalı
  };

  openInfoAlert(title: string, message: string): void {
    this.infoAlertTitle = title;
    this.infoAlertMessage = message;
    this.isInfoAlertOpen = true;
  }

  closeInfoAlert(): void {
    this.isInfoAlertOpen = false;
    if (this.isSuccess) {
      this.router.navigate(['/login']);
    }
  }

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    // Backend AuthService.cs içindeki SifreDeseni ile tam uyumlu regex
    const PASSWORD_PATTERN = /^(?=.*[a-zçğıöşü])(?=.*[A-ZÇĞİÖŞÜ])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])[^\s]{8,64}$/;

    this.registerForm = this.fb.group({
      fullName: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.pattern(PASSWORD_PATTERN)]],
      confirmPassword: ['', [Validators.required]],
      terms: [false, [Validators.requiredTrue]]
    }, {
      validators: this.passwordMatchValidator
    });

    // Şifre değiştikçe gereksinimleri anlık olarak kontrol et
    this.registerForm.get('password')?.valueChanges.subscribe(val => {
      this.checkPasswordRequirements(val || '');
    });
  }

  checkPasswordRequirements(password: string): void {
    this.passwordRequirements.length = password.length >= 8 && password.length <= 64;
    this.passwordRequirements.lowercase = /[a-zçğıöşü]/.test(password);
    this.passwordRequirements.uppercase = /[A-ZÇĞİÖŞÜ]/.test(password);
    this.passwordRequirements.digit = /\d/.test(password);
    this.passwordRequirements.special = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    this.passwordRequirements.noSpace = password.length > 0 && !/\s/.test(password);
  }

  passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const password = control.get('password')?.value;
    const confirmPassword = control.get('confirmPassword')?.value;
    const confirmControl = control.get('confirmPassword');

    if (password !== confirmPassword) {
      if (confirmControl && !confirmControl.hasError('required')) {
        confirmControl.setErrors({ passwordMismatch: true });
      }
      return { passwordMismatch: true };
    } else {
      if (confirmControl && confirmControl.hasError('passwordMismatch')) {
        confirmControl.setErrors(null);
      }
    }
    return null;
  }

  onSubmit(): void {
    if (this.registerForm.valid) {
      this.errorMessage = '';
      const registerDto = {
        kullaniciAdi: this.registerForm.value.fullName,
        email: this.registerForm.value.email,
        sifre: this.registerForm.value.password
      };

      this.authService.register(registerDto).subscribe({
        next: (response) => {
          this.isSuccess = true;
          this.openInfoAlert('Başarılı', 'Kayıt Başarılı! Giriş ekranına yönlendiriliyorsunuz.');
        },
        error: (err) => {
          console.error(err);
          this.isSuccess = false;
          this.errorMessage = err.error || 'Kayıt sırasında bir hata oluştu.';
          this.openInfoAlert('Kayıt Hatası', this.errorMessage);
        }
      });
    } else {
      this.registerForm.markAllAsTouched();
    }
  }
}

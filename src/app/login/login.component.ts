import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
  loginForm!: FormGroup;
  showPassword = false;
  errorMessage = '';

  isInfoAlertOpen = false;
  infoAlertTitle = '';
  infoAlertMessage = '';

  openInfoAlert(title: string, message: string): void {
    this.infoAlertTitle = title;
    this.infoAlertMessage = message;
    this.isInfoAlertOpen = true;
  }

  closeInfoAlert(): void {
    this.isInfoAlertOpen = false;
  }

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    // Eğer zaten giriş yapılmışsa doğrudan dashboard'a yönlendir
    if (this.authService.isLoggedIn()) {
      this.router.navigate(['/dashboard']);
    }

    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]],
      rememberMe: [false]
    });
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  onSubmit(): void {
    if (this.loginForm.valid) {
      this.errorMessage = '';
      const loginDto = {
        email: this.loginForm.value.email,
        sifre: this.loginForm.value.password
      };

      this.authService.login(loginDto).subscribe({
        next: (token) => {
          this.router.navigate(['/dashboard']);
        },
        error: (err) => {
          console.error(err);
          this.errorMessage = err.error || 'E-posta veya şifre hatalı.';
          this.openInfoAlert('Giriş Hatası', this.errorMessage);
        }
      });
    } else {
      this.loginForm.markAllAsTouched();
    }
  }
}

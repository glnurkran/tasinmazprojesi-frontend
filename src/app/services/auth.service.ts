import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { LoginDto, RegisterDto } from '../models/auth.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private baseUrl = `${environment.apiUrl}/auth`;

  constructor(private http: HttpClient) {}

  login(dto: LoginDto): Observable<any> {
    // Backend giriş başarılı olduğunda { token, rol } JSON nesnesi döndürür
    return this.http.post<any>(`${this.baseUrl}/login`, dto).pipe(
      tap(res => {
        if (res && res.token) {
          localStorage.setItem('token', res.token);
        }
        if (res && res.rol) {
          localStorage.setItem('role', res.rol);
        }
      })
    );
  }

  register(dto: RegisterDto): Observable<string> {
    return this.http.post(`${this.baseUrl}/register`, dto, { responseType: 'text' });
  }

  logout(): void {
    this.http.post(`${this.baseUrl}/logout`, {}).subscribe({
      next: () => {},
      error: (err) => console.error('Çıkış log hatası:', err)
    });
    localStorage.removeItem('token');
    localStorage.removeItem('role');
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem('token');
  }

  getUserRole(): string | null {
    // Öncelikle localStorage üzerinden doğrudan rol kontrolü yapalım
    const cachedRole = localStorage.getItem('role');
    if (cachedRole) {
      return cachedRole;
    }

    // Fallback: Token içerisinden rol bilgisini çözme
    const token = localStorage.getItem('token');
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      // Base64URL decoding
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );

      const payload = JSON.parse(jsonPayload);
      const roleKey = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role';
      const role = payload[roleKey] || payload['role'] || null;
      if (role) {
        localStorage.setItem('role', role); // Gelecekteki hızlı erişim için önbelleğe al
      }
      return role;
    } catch (e) {
      console.error('Token ayrıştırma hatası:', e);
      return null;
    }
  }

  isAdmin(): boolean {
    return this.getUserRole() === 'Admin';
  }
}

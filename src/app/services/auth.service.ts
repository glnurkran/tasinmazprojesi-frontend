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

  private normalizeRole(role: unknown): string | null {
    if (typeof role !== 'string') return null;

    const normalized = role.trim().toLowerCase();
    if (normalized === 'admin') return 'Admin';
    if (normalized === 'user') return 'User';
    return role.trim() || null;
  }

  login(dto: LoginDto): Observable<any> {
    // Backend giriş başarılı olduğunda { token, rol } JSON nesnesi döndürür
    return this.http.post<any>(`${this.baseUrl}/login`, dto).pipe(
      tap(res => {
        if (res && res.token) {
          localStorage.setItem('token', res.token);
        }
        const role = this.normalizeRole(res?.rol);
        if (role) {
          localStorage.setItem('role', role);
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
      const normalizedRole = this.normalizeRole(cachedRole);
      if (normalizedRole && normalizedRole !== cachedRole) {
        localStorage.setItem('role', normalizedRole);
      }
      return normalizedRole;
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
      const role = this.normalizeRole(payload[roleKey] || payload['role'] || null);
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

  getUserName(): string | null {
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
      const nameKey = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name';
      return payload[nameKey] || payload['unique_name'] || payload['name'] || null;
    } catch (e) {
      console.error('Token ayrıştırma hatası:', e);
      return null;
    }
  }
}

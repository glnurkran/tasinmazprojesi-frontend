import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LogService } from '../services/log.service';
import { UserService } from '../services/user.service';
import { AuthService } from '../services/auth.service';
import { LogDto } from '../models/log.model';
import { UserDto } from '../models/user.model';

@Component({
  selector: 'app-logs',
  templateUrl: './logs.component.html',
  styleUrls: ['./logs.component.scss']
})
export class LogsComponent implements OnInit {
  logs: LogDto[] = [];
  users: UserDto[] = [];

  // Filtre Değişkenleri
  selectedUserId: number | null = null;
  selectedIslem: string = '';
  singleDate: string = '';

  // Durum Takipçileri
  isLoading: boolean = false;
  isExportingExcel: boolean = false;
  isExportingPdf: boolean = false;

  constructor(
    private logService: LogService,
    private userService: UserService,
    public authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadLogs();
    this.loadUsers();
  }

  // Seçilen günü o günün başlangıcı (00:00:00) ve bitişi (23:59:59) olarak aralık formatına çevirir
  getDateRange(): { startIso?: string; endIso?: string } {
    if (!this.singleDate) return {};
    const start = new Date(`${this.singleDate}T00:00:00`);
    const end = new Date(`${this.singleDate}T23:59:59.999`);
    return {
      startIso: start.toISOString(),
      endIso: end.toISOString()
    };
  }

  loadLogs(): void {
    this.isLoading = true;
    const userId = this.selectedUserId ? Number(this.selectedUserId) : undefined;
    const { startIso, endIso } = this.getDateRange();

    this.logService.getAll(userId, this.selectedIslem || undefined, startIso, endIso).subscribe({
      next: (res) => {
        this.logs = res || [];
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Loglar yüklenirken hata oluştu:', err);
        this.isLoading = false;
      }
    });
  }

  loadUsers(): void {
    this.userService.getAll().subscribe({
      next: (res) => {
        this.users = res || [];
      },
      error: (err) => {
        console.error('Kullanıcı listesi çekilemedi:', err);
      }
    });
  }

  applyFilters(): void {
    this.loadLogs();
  }

  resetFilters(): void {
    this.selectedUserId = null;
    this.selectedIslem = '';
    this.singleDate = '';
    this.loadLogs();
  }

  downloadExcel(): void {
    this.isExportingExcel = true;
    const userId = this.selectedUserId ? Number(this.selectedUserId) : undefined;
    const { startIso, endIso } = this.getDateRange();

    this.logService.exportExcel(userId, this.selectedIslem || undefined, startIso, endIso).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Sistem_Loglari_${new Date().getTime()}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.isExportingExcel = false;
      },
      error: (err) => {
        console.error('Excel indirilirken hata oluştu:', err);
        this.isExportingExcel = false;
      }
    });
  }

  downloadPdf(): void {
    this.isExportingPdf = true;
    const userId = this.selectedUserId ? Number(this.selectedUserId) : undefined;
    const { startIso, endIso } = this.getDateRange();

    this.logService.exportPdf(userId, this.selectedIslem || undefined, startIso, endIso).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Sistem_Loglari_${new Date().getTime()}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.isExportingPdf = false;
      },
      error: (err) => {
        console.error('PDF indirilirken hata oluştu:', err);
        this.isExportingPdf = false;
      }
    });
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}

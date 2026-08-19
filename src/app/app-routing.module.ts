import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from './login/login.component';
import { RegisterComponent } from './register/register.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { LogsComponent } from './logs/logs.component';
import { UsersComponent } from './users/users.component';
import { AnalizComponent } from './analiz/analiz.component';
import { AuthGuard } from './guards/auth.guard';
import { RoleGuard } from './guards/role.guard';
import { UnsavedChangesGuard } from './guards/unsaved-changes.guard';
import { SpatialAnalysisGuard } from './guards/spatial-analysis.guard';

const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [AuthGuard] },
  { path: 'analiz', component: AnalizComponent, canActivate: [AuthGuard, SpatialAnalysisGuard], canDeactivate: [UnsavedChangesGuard] },
  { path: 'logs', component: LogsComponent, canActivate: [AuthGuard, RoleGuard] },
  { path: 'users', component: UsersComponent, canActivate: [AuthGuard, RoleGuard] },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: '**', redirectTo: '/login' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }

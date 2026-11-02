-- 0007 · Tablas del login del panel (Better Auth 1.7.10 con el plugin de dos factores).
-- SQL generado con getMigrations() de better-auth a partir de lib/auth.js; los nombres de tabla se adaptan al
-- prefijo auth_ (las columnas son las de Better Auth). Borrado en cascada solo dentro de las tablas de login.
-- Los permisos de rukc_app llegan por los privilegios por defecto de la migración 0006.
-- El rol del panel (propietario, operador) está en la tabla admin (0004), unida por email.

create table "auth_usuario" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "twoFactorEnabled" boolean);
create table "auth_sesion" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "auth_usuario" ("id") on delete cascade);
create table "auth_cuenta" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "auth_usuario" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);
create table "auth_verificacion" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);
create table "auth_dos_factores" ("id" text not null primary key, "secret" text not null, "backupCodes" text not null, "userId" text not null references "auth_usuario" ("id") on delete cascade, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);
create index "auth_sesion_userId_idx" on "auth_sesion" ("userId");
create index "auth_cuenta_userId_idx" on "auth_cuenta" ("userId");
create index "auth_verificacion_identifier_idx" on "auth_verificacion" ("identifier");
create index "auth_dos_factores_secret_idx" on "auth_dos_factores" ("secret");
create index "auth_dos_factores_userId_idx" on "auth_dos_factores" ("userId");

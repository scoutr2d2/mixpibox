import { provideHttpClient, withFetch } from '@angular/common/http'
import { bootstrapApplication } from '@angular/platform-browser'
import { provideRouter } from '@angular/router'
import { App } from './app/app'
import { ROUTEN } from './app/app.routes'

bootstrapApplication(App, {
  providers: [provideRouter(ROUTEN), provideHttpClient(withFetch())],
}).catch((err) => console.error(err))

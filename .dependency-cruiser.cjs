/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'dominio-no-depende-de-nada',
      severity: 'error',
      comment: 'La capa de dominio no puede importar aplicacion, infraestructura ni librerias de framework.',
      from: { path: 'apps/api/src/modulos/[^/]+/dominio' },
      to: { path: ['/aplicacion/', '/infraestructura/', '/presentacion/', 'node_modules/(@nestjs|pg)'] },
    },
    {
      name: 'aplicacion-no-depende-de-infraestructura',
      severity: 'error',
      from: { path: 'apps/api/src/modulos/[^/]+/aplicacion' },
      to: { path: ['/infraestructura/', '/presentacion/'] },
    },
    {
      name: 'modulos-solo-via-api-publica',
      severity: 'error',
      comment: 'Un modulo solo puede importar el index.ts de otro modulo.',
      from: { path: 'apps/api/src/modulos/([^/]+)/' },
      to: {
        path: 'apps/api/src/modulos/([^/]+)/(dominio|aplicacion|infraestructura|presentacion)/',
        pathNot: 'apps/api/src/modulos/$1/',
      },
    },
  ],
};

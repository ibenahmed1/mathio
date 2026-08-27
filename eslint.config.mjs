import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const config = [
  {
    ignores: [
      '.next/**',
      '.agents/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'app/generated/**',
      'public/**',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Le préfixe `_` marque un identifiant volontairement inutilisé (paramètre
      // imposé par une signature, erreur ignorée). `ignoreRestSiblings` couvre
      // le motif `const { a, b, ...reste } = obj` utilisé pour retirer des champs.
      '@typescript-eslint/no-unused-vars': ['warn', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
]

export default config

// Briques de formulaire du système, partagées par tous les écrans de saisie
// (sauf connexion/inscription, qui gardent leur mise en page plein écran).
//
// Elles ne portent aucun style en propre : tout vient des classes .form-* de
// app/globals.css, où la convention est définie une fois. Ces composants ne
// sont là que pour éviter de réécrire la même structure libellé / champ /
// aide / erreur dans chaque formulaire — c'était jusqu'ici un helper « Field »
// recopié dans une demi-douzaine de fichiers, chacun avec ses écarts.
//
// Pas de « use client » : aucun état ici, ces composants s'utilisent aussi
// bien dans un composant serveur que dans un composant client.

export function Field({
  label,
  required,
  optional,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  /* Marque explicitement un champ facultatif. À réserver aux formulaires où
     l'essentiel est requis : tout marquer « Optionnel » ne dit plus rien. */
  optional?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`form-field ${className ?? ''}`}>
      <span className="form-label">
        {label}
        {required && <span className="form-required">*</span>}
        {optional && <span className="form-optional">Optionnel</span>}
      </span>
      {children}
      {/* L'erreur remplace l'aide : afficher les deux fait lire la mauvaise. */}
      {error ? <span className="form-error">{error}</span> : hint ? <span className="form-hint">{hint}</span> : null}
    </label>
  );
}

// Section encartée. Avec « step », elle prend une pastille numérotée : à
// réserver aux formulaires assez longs pour qu'un ordre de lecture aide
// (Nouveau colis, Nouveau produit). Un formulaire court en pose une seule,
// sans numéro.
export function FormSection({
  step,
  title,
  className,
  children,
}: {
  step?: number;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`form-section ${className ?? ''}`}>
      {title && (
        <div className="form-step-title">
          {step !== undefined && <span className="form-step-badge">{step}</span>}
          <h2>{title}</h2>
        </div>
      )}
      {children}
    </section>
  );
}

// Champ encadré avec pastille collée : le préfixe/suffixe fait partie du
// cadre, pour qu'on lise « 120 DH » et non un nombre nu. Le champ posé à
// l'intérieur porte « input-bare » (et non « input-basic ») : c'est le cadre
// parent qui dessine la bordure et l'anneau de focus.
export function Affix({
  prefix,
  suffix,
  children,
}: {
  prefix?: string;
  suffix?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="form-affix">
      {prefix && <span className="form-affix-chip">{prefix}</span>}
      {children}
      {suffix && <span className="form-affix-chip">{suffix}</span>}
    </div>
  );
}

// Champ quantité avec ses boutons −/+ collés. Le champ reste saisissable au
// clavier : les boutons ne sont qu'un raccourci pour les petits ajustements.
export function QuantiteInput({
  value,
  onChange,
  min = 1,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
  min?: number;
}) {
  const pas = (delta: number) => onChange(String(Math.max(min, (Number(value) || min) + delta)));
  return (
    <div className="form-affix">
      <button type="button" onClick={() => pas(-1)} aria-label="Diminuer la quantité" className="form-affix-step">
        −
      </button>
      <input
        {...props}
        className={`input-bare px-0 text-center font-semibold ${className ?? ''}`}
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          onChange(String(Math.max(min, Number(e.target.value) || min)));
          props.onBlur?.(e);
        }}
      />
      <button type="button" onClick={() => pas(1)} aria-label="Augmenter la quantité" className="form-affix-step">
        +
      </button>
    </div>
  );
}

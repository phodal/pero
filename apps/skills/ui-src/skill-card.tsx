import React from 'react';
import {Button, Card, Icon} from '@pero/app-sdk/ui';

export function SkillCard({name, category, description, publisher, icon, version, status, action, onOpen}: {
  name: string;
  category?: string;
  description: string;
  publisher: string;
  icon: string;
  version: {label: string; full: string};
  status?: React.ReactNode;
  action?: React.ReactNode;
  onOpen: () => void;
}) {
  return <Card asChild className="skills-card">
    <article>
      <Button variant="ghost" className="skills-card-open" onClick={onOpen}>
        <span className="skills-glyph"><Icon name={icon} size={18}/></span>
        <span className="skills-card-heading">
          <span role="heading" aria-level={3} title={name}>{name}</span>
          <span className="skills-card-publisher" title={publisher}>{publisher}</span>
        </span>
      </Button>
      <p className="skills-card-description">{description}</p>
      <div className="skills-card-meta">
        {category && <span className="skills-card-publisher" title={category}>{category}</span>}
        <span className="skills-card-version" title={version.full}>{version.label}</span>
      </div>
      <div className="skills-card-footer">{status}<div className="skills-card-action">{action}</div></div>
    </article>
  </Card>;
}

/*--------------------------------*- C++ -*----------------------------------*\
  =========                 |
  \\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox
   \\    /   O peration     | Website:  https://openfoam.org
    \\  /    A nd           | Version:  12
     \\/     M anipulation  |
\*---------------------------------------------------------------------------*/
FoamFile
{
    format      ascii;
    class       dictionary;
    location    "constant";
    object      physicalProperties;
}
// ************************************************************************* //

thermoType 
{     
    type            heRhoThermo;     
    mixture         pureMixture;     
    transport       const;     
    thermo          hConst;     
    equationOfState rhoConst;     
    specie          specie;     
    energy          sensibleInternalEnergy; 
}  

mixture 
{     
    specie     
    {         
        // Molecular weight of aluminum [g/mol]
        molWeight   26.98;     
    }     
    equationOfState     
    {         
        // Density of aluminum [kg/m³]
        // Using average value as density changes between liquid and solid
        rho         2700;     
    }     
    thermodynamics     
    {         
        // Specific heat capacity of aluminum [J/(kg·K)]
        Cp          900;         
        // Heat of formation [J/kg]
        hf          0;     
    }     
    transport     
    {         
        // Dynamic viscosity of liquid aluminum [Pa·s]
        mu          1.3e-3;         
        // Prandtl number of aluminum [dimensionless]
        Pr          0.013;     
    } 
}
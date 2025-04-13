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
    class       volScalarField;
    location    "0";
    object      T.metal;
}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

dimensions      [0 0 0 1 0 0 0];

internalField   uniform 300;

boundaryField
{
    inlet
    {
        type            calculated;
        value           uniform 300;
    }
    riser
    {
        type            calculated;
        value           uniform 300;
    }
    model
    {
        type            calculated;
        value           uniform 300;
    }
}

sources
{
    injection
    {
        type            uniformFixedValue;
        uniformValue    
        {
            type            constant;
            value           1000;
        }
    }
}


// ************************************************************************* //
